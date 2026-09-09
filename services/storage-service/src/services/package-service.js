import { createHmac } from 'node:crypto';
import { canonicalJson } from '../crypto/canonical-json.js';
import { decryptRecord, encryptRecord, requestFingerprint } from '../crypto/envelope.js';
import { StorageError } from '../errors.js';

function publicMetadata(value, masterKey, duplicate = false) {
  const protectedObjectReference = createHmac('sha256', masterKey)
    .update('rhu-labchain.protected-object-reference/v1')
    .update('\0')
    .update(value.objectReference)
    .digest('base64url');
  return {
    id: value.id,
    recordId: value.recordId,
    version: value.version,
    objectReference: value.objectReference,
    // Compatibility names used by the records-service publication outbox.
    // They identify encrypted bytes only; neither field contains plaintext.
    protectedObjectReference,
    objectProvider: value.objectProvider,
    envelopeHash: value.envelopeHash,
    ciphertextHash: value.envelopeHash,
    sizeBytes: value.sizeBytes,
    algorithm: value.algorithm,
    keyReference: value.keyReference,
    createdAt: value.createdAt,
    duplicate,
  };
}

export class PackageService {
  constructor({ repository, objectStore, masterKey, masterKeyId, maxJsonBytes = 5_000_000, now = () => new Date().toISOString() }) {
    this.repository = repository;
    this.objectStore = objectStore;
    this.masterKey = masterKey;
    this.masterKeyId = masterKeyId;
    this.maxJsonBytes = maxJsonBytes;
    this.now = now;
  }

  async create({ recordId, version, record, idempotencyKey }) {
    const canonicalRecord = canonicalJson(record);
    if (Buffer.byteLength(canonicalRecord, 'utf8') > this.maxJsonBytes) {
      throw new StorageError(413, 'The finalized record exceeds the storage size limit.', 'RECORD_TOO_LARGE');
    }
    const fingerprint = requestFingerprint(this.masterKey, recordId, version, canonicalRecord);
    const byKey = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (byKey) {
      if (byKey.requestFingerprint !== fingerprint) {
        throw new StorageError(409, 'The idempotency key was already used for a different package.', 'IDEMPOTENCY_CONFLICT');
      }
      return publicMetadata(byKey, this.masterKey, true);
    }
    const byVersion = await this.repository.findVersion(recordId, version);
    if (byVersion) {
      if (byVersion.requestFingerprint !== fingerprint) {
        throw new StorageError(409, 'This record version is already packaged with different content.', 'VERSION_IMMUTABLE');
      }
      return publicMetadata(byVersion, this.masterKey, true);
    }

    const encrypted = encryptRecord({
      recordId,
      version,
      canonicalRecord,
      masterKey: this.masterKey,
      masterKeyId: this.masterKeyId,
    });
    const receipt = await this.objectStore.put(encrypted.bytes, encrypted.envelopeHash);
    const metadata = {
      recordId,
      version,
      idempotencyKey,
      requestFingerprint: fingerprint,
      objectReference: receipt.objectReference,
      objectProvider: receipt.provider,
      envelopeHash: encrypted.envelopeHash,
      sizeBytes: receipt.sizeBytes,
      algorithm: 'AES-256-GCM',
      keyReference: this.masterKeyId,
      createdAt: this.now(),
    };
    const committed = await this.repository.commitPackage(metadata);
    if (committed.outcome === 'idempotency-conflict') throw new StorageError(409, 'The idempotency key was already used for a different package.', 'IDEMPOTENCY_CONFLICT');
    if (committed.outcome === 'version-conflict') throw new StorageError(409, 'This record version is immutable.', 'VERSION_IMMUTABLE');
    return publicMetadata(committed.value, this.masterKey, committed.outcome === 'duplicate');
  }

  async #loadAndDecrypt(recordId, version) {
    const metadata = await this.repository.findVersion(recordId, version);
    if (!metadata) throw new StorageError(404, 'Encrypted record version was not found.', 'PACKAGE_NOT_FOUND');
    const bytes = await this.objectStore.get(metadata.objectReference);
    const record = decryptRecord({
      bytes,
      expectedHash: metadata.envelopeHash,
      masterKey: this.masterKey,
      expectedRecordId: recordId,
      expectedVersion: version,
      expectedKeyId: metadata.keyReference,
    });
    return { metadata, record };
  }

  async retrieve({ recordId, version, callerService, requestId }) {
    try {
      const loaded = await this.#loadAndDecrypt(recordId, version);
      await this.repository.recordRetrieval({
        recordId,
        version,
        callerService,
        requestId,
        outcome: 'SUCCEEDED',
        occurredAt: this.now(),
      });
      return {
        recordId,
        version,
        record: loaded.record,
        verified: true,
        envelopeHash: loaded.metadata.envelopeHash,
      };
    } catch (error) {
      await this.repository.recordRetrieval({
        recordId,
        version,
        callerService,
        requestId,
        outcome: 'FAILED',
        failureCode: error.code || 'RETRIEVAL_FAILED',
        occurredAt: this.now(),
      }).catch(() => {});
      throw error;
    }
  }

  async verify({ recordId, version, callerService, requestId }) {
    try {
      const loaded = await this.#loadAndDecrypt(recordId, version);
      await this.repository.recordRetrieval({
        recordId,
        version,
        callerService,
        requestId,
        outcome: 'VERIFIED',
        occurredAt: this.now(),
      });
      return {
        recordId,
        version,
        verified: true,
        envelopeHash: loaded.metadata.envelopeHash,
        objectProvider: loaded.metadata.objectProvider,
        keyReference: loaded.metadata.keyReference,
      };
    } catch (error) {
      await this.repository.recordRetrieval({
        recordId,
        version,
        callerService,
        requestId,
        outcome: 'FAILED',
        failureCode: error.code || 'VERIFY_FAILED',
        occurredAt: this.now(),
      }).catch(() => {});
      throw error;
    }
  }
}
