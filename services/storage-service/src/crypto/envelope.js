import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import { IntegrityError, StorageError } from '../errors.js';

const SCHEMA = 'rhu-labchain.encrypted-record/v1';
const ALGORITHM = 'AES-256-GCM';

function aad(recordId, version, purpose) {
  return Buffer.from(canonicalJson({ purpose, recordId, schema: SCHEMA, version }), 'utf8');
}

function encryptAesGcm(key, nonce, plaintext, associatedData) {
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

function decryptAesGcm(key, nonce, ciphertext, tag, associatedData) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(associatedData);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new IntegrityError();
  }
}

export function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function requestFingerprint(masterKey, recordId, version, canonicalRecord) {
  return createHmac('sha256', masterKey)
    .update(canonicalJson({ recordId, version }))
    .update('\0')
    .update(canonicalRecord)
    .digest('hex');
}

export function encryptRecord({ recordId, version, canonicalRecord, masterKey, masterKeyId, random = randomBytes }) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new Error('A 32-byte master key is required.');
  const dataKey = random(32);
  const recordNonce = random(12);
  const wrapNonce = random(12);
  if (dataKey.length !== 32 || recordNonce.length !== 12 || wrapNonce.length !== 12) {
    throw new Error('The secure random source returned an invalid byte length.');
  }
  const encrypted = encryptAesGcm(dataKey, recordNonce, Buffer.from(canonicalRecord, 'utf8'), aad(recordId, version, 'record'));
  const wrapped = encryptAesGcm(masterKey, wrapNonce, dataKey, aad(recordId, version, 'data-key'));
  dataKey.fill(0);

  const envelope = {
    algorithm: ALGORITHM,
    authTag: encrypted.tag.toString('base64'),
    ciphertext: encrypted.ciphertext.toString('base64'),
    keyWrap: {
      algorithm: ALGORITHM,
      authTag: wrapped.tag.toString('base64'),
      keyId: masterKeyId,
      nonce: wrapNonce.toString('base64'),
      wrappedKey: wrapped.ciphertext.toString('base64'),
    },
    nonce: recordNonce.toString('base64'),
    recordId,
    schema: SCHEMA,
    version,
  };
  const bytes = Buffer.from(canonicalJson(envelope), 'utf8');
  return { envelope, bytes, envelopeHash: sha256Buffer(bytes) };
}

function decodeBase64(value, field, expectedLength) {
  if (typeof value !== 'string') throw new IntegrityError();
  const decoded = Buffer.from(value, 'base64');
  if ((expectedLength !== undefined && decoded.length !== expectedLength) || decoded.toString('base64') !== value) {
    throw new IntegrityError(`The encrypted object contains invalid ${field} encoding.`);
  }
  return decoded;
}

export function decryptRecord({ bytes, expectedHash, masterKey, expectedRecordId, expectedVersion, expectedKeyId }) {
  if (sha256Buffer(bytes) !== expectedHash) throw new IntegrityError('The encrypted object hash does not match its receipt.');
  let envelope;
  try {
    envelope = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new IntegrityError('The encrypted object is not a valid envelope.');
  }
  if (
    envelope.schema !== SCHEMA ||
    envelope.algorithm !== ALGORITHM ||
    envelope.keyWrap?.algorithm !== ALGORITHM ||
    (expectedKeyId !== undefined && envelope.keyWrap?.keyId !== expectedKeyId) ||
    envelope.recordId !== expectedRecordId ||
    envelope.version !== expectedVersion
  ) {
    throw new IntegrityError('The encrypted object metadata does not match the requested record.');
  }
  const wrapNonce = decodeBase64(envelope.keyWrap.nonce, 'keyWrap.nonce', 12);
  const wrapTag = decodeBase64(envelope.keyWrap.authTag, 'keyWrap.authTag', 16);
  const wrappedKey = decodeBase64(envelope.keyWrap.wrappedKey, 'keyWrap.wrappedKey', 32);
  const dataKey = decryptAesGcm(masterKey, wrapNonce, wrappedKey, wrapTag, aad(expectedRecordId, expectedVersion, 'data-key'));
  if (dataKey.length !== 32) throw new IntegrityError();
  const recordNonce = decodeBase64(envelope.nonce, 'nonce', 12);
  const recordTag = decodeBase64(envelope.authTag, 'authTag', 16);
  const ciphertext = decodeBase64(envelope.ciphertext, 'ciphertext');
  if (!ciphertext.length) throw new IntegrityError();
  let plaintext;
  try {
    plaintext = decryptAesGcm(dataKey, recordNonce, ciphertext, recordTag, aad(expectedRecordId, expectedVersion, 'record'));
  } finally {
    dataKey.fill(0);
  }
  let record;
  const plaintextText = plaintext.toString('utf8');
  try {
    record = JSON.parse(plaintextText);
  } catch {
    plaintext.fill(0);
    throw new IntegrityError('The decrypted payload is not valid JSON.');
  }
  const canonical = canonicalJson(record);
  plaintext.fill(0);
  if (canonical !== plaintextText) throw new IntegrityError('The decrypted payload is not canonical JSON.');
  return record;
}

export const envelopeConstants = Object.freeze({ schema: SCHEMA, algorithm: ALGORITHM });
