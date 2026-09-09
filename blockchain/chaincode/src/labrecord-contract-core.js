const RECORD_NAMESPACE = 'record';
const INDEX_NAMESPACE = 'record-index';
const RECORD_SCHEMA = 'rhu-labchain.record-proof/v1';
const WRITER_MSP = 'RHULabMSP';
const MEMBER_MSPS = new Set([WRITER_MSP, 'VerifierMSP']);
const REASON_CODES = new Set(['CORRECTED', 'ISSUED_IN_ERROR', 'SECURITY', 'OTHER']);
const REGISTRATION_FIELDS = new Set([
  'recordId', 'version', 'documentHash', 'encryptedCidReference',
  'approvalTimestamp', 'issuingOrganization', 'transactionMetadata',
]);
const TRANSACTION_METADATA_FIELDS = new Set(['correlationId', 'source']);

function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requireAllowedFields(value, allowed, context) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('PRIVACY_FIELD_REJECTED', `${context} field '${key}' is not permitted on the ledger.`);
  }
}

function normalizeTimestamp(value, field) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    fail('INVALID_TIMESTAMP', `${field} must be an ISO-8601 timestamp.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail('INVALID_TIMESTAMP', `${field} must be an ISO-8601 timestamp.`);
  return new Date(milliseconds).toISOString();
}

function normalizeVersion(value) {
  const version = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
    fail('INVALID_VERSION', 'Record version must be a positive integer.');
  }
  return version;
}

function normalizeRecordId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    fail('INVALID_RECORD_ID', 'Record identifier must be an opaque 8-128 character identifier.');
  }
  return value;
}

function normalizeHash(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail('INVALID_HASH', 'Document hash must be a lowercase SHA-256 digest.');
  }
  return value;
}

function normalizeText(value, field, minimum, maximum, pattern) {
  if (typeof value !== 'string') fail('VALIDATION_FAILED', `${field} must be text.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum || (pattern && !pattern.test(normalized))) {
    fail('VALIDATION_FAILED', `${field} is invalid.`);
  }
  return normalized;
}

function normalizeRegistration(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > 16_384) {
    fail('VALIDATION_FAILED', 'Registration payload must be a JSON string no larger than 16 KiB.');
  }
  let value;
  try { value = JSON.parse(input); }
  catch { fail('VALIDATION_FAILED', 'Registration payload must be valid JSON.'); }
  if (!isPlainObject(value)) fail('VALIDATION_FAILED', 'Registration payload must be a JSON object.');
  requireAllowedFields(value, REGISTRATION_FIELDS, 'Registration');

  let transactionMetadata = null;
  if (value.transactionMetadata !== undefined) {
    if (!isPlainObject(value.transactionMetadata)) fail('VALIDATION_FAILED', 'transactionMetadata must be an object.');
    requireAllowedFields(value.transactionMetadata, TRANSACTION_METADATA_FIELDS, 'Transaction metadata');
    transactionMetadata = {};
    if (value.transactionMetadata.correlationId !== undefined) {
      transactionMetadata.correlationId = normalizeText(value.transactionMetadata.correlationId, 'correlationId', 1, 128, /^[A-Za-z0-9._:-]+$/);
    }
    if (value.transactionMetadata.source !== undefined) {
      transactionMetadata.source = normalizeText(value.transactionMetadata.source, 'source', 1, 80, /^[A-Za-z0-9._:-]+$/);
    }
    if (Object.keys(transactionMetadata).length === 0) transactionMetadata = null;
  }

  let encryptedCidReference = null;
  if (value.encryptedCidReference !== undefined && value.encryptedCidReference !== null) {
    encryptedCidReference = normalizeText(value.encryptedCidReference, 'encryptedCidReference', 8, 512, /^[A-Za-z0-9._:-]+$/);
  }

  return {
    recordId: normalizeRecordId(value.recordId),
    version: normalizeVersion(value.version),
    documentHash: normalizeHash(value.documentHash),
    encryptedCidReference,
    approvalTimestamp: normalizeTimestamp(value.approvalTimestamp, 'approvalTimestamp'),
    issuingOrganization: normalizeText(value.issuingOrganization, 'issuingOrganization', 2, 120, /^[\p{L}\p{N} .,'&()/-]+$/u),
    transactionMetadata,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function sameRegistration(left, right) {
  const fields = ['recordId', 'version', 'documentHash', 'encryptedCidReference', 'approvalTimestamp', 'issuingOrganization', 'transactionMetadata'];
  const select = (value) => Object.fromEntries(fields.map((field) => [field, value[field] ?? null]));
  return JSON.stringify(stableValue(select(left))) === JSON.stringify(stableValue(select(right)));
}

function timestampToIso(timestamp) {
  const seconds = Number(timestamp?.seconds?.toString?.() ?? timestamp?.seconds ?? 0);
  const nanos = Number(timestamp?.nanos ?? 0);
  return new Date((seconds * 1000) + Math.floor(nanos / 1_000_000)).toISOString();
}

export class LabRecordContractCore {
  #requireMember(ctx) {
    if (!MEMBER_MSPS.has(ctx.clientIdentity.getMSPID())) fail('ACCESS_DENIED', 'The client organization is not a channel member.');
  }

  #requireWriter(ctx) {
    if (ctx.clientIdentity.getMSPID() !== WRITER_MSP) {
      fail('ACCESS_DENIED', 'Only the RHU laboratory organization may change record proofs.');
    }
  }

  #recordKey(ctx, recordId, version) {
    return ctx.stub.createCompositeKey(RECORD_NAMESPACE, [recordId, String(version).padStart(10, '0')]);
  }

  #indexKey(ctx, recordId) { return ctx.stub.createCompositeKey(INDEX_NAMESPACE, [recordId]); }

  async #readRecord(ctx, recordId, version) {
    const bytes = await ctx.stub.getState(this.#recordKey(ctx, recordId, version));
    return bytes?.length ? JSON.parse(Buffer.from(bytes).toString('utf8')) : null;
  }

  async #readVersions(ctx, recordId) {
    const bytes = await ctx.stub.getState(this.#indexKey(ctx, recordId));
    if (!bytes?.length) return [];
    const versions = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!Array.isArray(versions) || versions.some((version) => !Number.isSafeInteger(version) || version < 1)) {
      fail('LEDGER_STATE_INVALID', 'Record version index is corrupt.');
    }
    return versions;
  }

  async #writeRecord(ctx, record) {
    await ctx.stub.putState(this.#recordKey(ctx, record.recordId, record.version), Buffer.from(JSON.stringify(stableValue(record))));
  }

  async #register(ctx, payload, firstVersion) {
    const versions = await this.#readVersions(ctx, payload.recordId);
    const existing = await this.#readRecord(ctx, payload.recordId, payload.version);
    if (existing) {
      if (!sameRegistration(existing, payload)) fail('VERSION_CONFLICT', 'This record version already contains a different proof.');
      return existing;
    }
    if (firstVersion && (payload.version !== 1 || versions.length !== 0)) {
      fail('VERSION_SEQUENCE_INVALID', 'RegisterRecord may create only the first version.');
    }
    if (!firstVersion) {
      const latest = versions.at(-1);
      if (payload.version <= 1 || latest === undefined || payload.version !== latest + 1) {
        fail('VERSION_SEQUENCE_INVALID', 'Record versions must be registered sequentially.');
      }
    }

    const timestamp = timestampToIso(ctx.stub.getTxTimestamp());
    const transactionId = ctx.stub.getTxID();
    const record = {
      schema: RECORD_SCHEMA,
      ...payload,
      status: 'REGISTERED',
      releaseTimestamp: null,
      revokedAt: null,
      reasonCode: null,
      registeredAt: timestamp,
      lastUpdatedAt: timestamp,
      registrationTransactionId: transactionId,
      lastTransactionId: transactionId,
    };
    await this.#writeRecord(ctx, record);
    await ctx.stub.putState(this.#indexKey(ctx, payload.recordId), Buffer.from(JSON.stringify([...versions, payload.version])));
    return record;
  }

  async RegisterRecord(ctx, payloadJson) {
    this.#requireWriter(ctx);
    return this.#register(ctx, normalizeRegistration(payloadJson), true);
  }

  async RegisterRecordVersion(ctx, payloadJson) {
    this.#requireWriter(ctx);
    return this.#register(ctx, normalizeRegistration(payloadJson), false);
  }

  async GetRecord(ctx, recordIdValue, versionValue) {
    this.#requireMember(ctx);
    const recordId = normalizeRecordId(recordIdValue);
    const version = normalizeVersion(versionValue);
    const record = await this.#readRecord(ctx, recordId, version);
    if (!record) fail('RECORD_NOT_FOUND', 'Record version does not exist.');
    return record;
  }

  async ReleaseRecord(ctx, recordIdValue, versionValue, releaseTimestampValue) {
    this.#requireWriter(ctx);
    const recordId = normalizeRecordId(recordIdValue);
    const version = normalizeVersion(versionValue);
    const releaseTimestamp = normalizeTimestamp(releaseTimestampValue, 'releaseTimestamp');
    const record = await this.#readRecord(ctx, recordId, version);
    if (!record) fail('RECORD_NOT_FOUND', 'Record version does not exist.');
    if (record.status === 'REVOKED') fail('RECORD_REVOKED', 'A revoked proof cannot be released.');
    if (record.status === 'RELEASED') {
      if (record.releaseTimestamp === releaseTimestamp) return record;
      fail('ALREADY_RELEASED', 'This proof was already released at another timestamp.');
    }
    if (Date.parse(releaseTimestamp) < Date.parse(record.approvalTimestamp)) {
      fail('VERSION_SEQUENCE_INVALID', 'Release cannot precede approval.');
    }
    const updated = {
      ...record,
      status: 'RELEASED',
      releaseTimestamp,
      lastUpdatedAt: timestampToIso(ctx.stub.getTxTimestamp()),
      releaseTransactionId: ctx.stub.getTxID(),
      lastTransactionId: ctx.stub.getTxID(),
    };
    await this.#writeRecord(ctx, updated);
    return updated;
  }

  async RevokeRecord(ctx, recordIdValue, versionValue, reasonCodeValue, revokedAtValue) {
    this.#requireWriter(ctx);
    const recordId = normalizeRecordId(recordIdValue);
    const version = normalizeVersion(versionValue);
    const reasonCode = String(reasonCodeValue || '').toUpperCase();
    if (!REASON_CODES.has(reasonCode)) fail('VALIDATION_FAILED', 'Revocation reason code is invalid.');
    const revokedAt = normalizeTimestamp(revokedAtValue, 'revokedAt');
    const record = await this.#readRecord(ctx, recordId, version);
    if (!record) fail('RECORD_NOT_FOUND', 'Record version does not exist.');
    if (record.status === 'REVOKED') {
      if (record.reasonCode === reasonCode && record.revokedAt === revokedAt) return record;
      fail('ALREADY_REVOKED', 'This proof was already revoked with different metadata.');
    }
    if (Date.parse(revokedAt) < Date.parse(record.approvalTimestamp)) {
      fail('VERSION_SEQUENCE_INVALID', 'Revocation cannot precede approval.');
    }
    const updated = {
      ...record,
      status: 'REVOKED',
      reasonCode,
      revokedAt,
      lastUpdatedAt: timestampToIso(ctx.stub.getTxTimestamp()),
      revokeTransactionId: ctx.stub.getTxID(),
      lastTransactionId: ctx.stub.getTxID(),
    };
    await this.#writeRecord(ctx, updated);
    return updated;
  }

  async VerifyRecord(ctx, recordIdValue, versionValue, documentHashValue) {
    this.#requireMember(ctx);
    const recordId = normalizeRecordId(recordIdValue);
    const version = normalizeVersion(versionValue);
    const documentHash = normalizeHash(documentHashValue);
    const record = await this.#readRecord(ctx, recordId, version);
    if (!record) return { valid: false, status: 'NOT_FOUND', recordId, version };
    const valid = record.documentHash === documentHash && record.status !== 'REVOKED';
    return {
      valid,
      status: valid ? record.status : 'NOT_VERIFIED',
      recordId,
      version,
      issuingOrganization: record.issuingOrganization,
      approvalTimestamp: record.approvalTimestamp,
      releaseTimestamp: record.releaseTimestamp,
    };
  }

  async GetRecordHistory(ctx, recordIdValue) {
    this.#requireMember(ctx);
    const recordId = normalizeRecordId(recordIdValue);
    const versions = await this.#readVersions(ctx, recordId);
    const items = [];
    for (const version of versions) {
      const iterator = await ctx.stub.getHistoryForKey(this.#recordKey(ctx, recordId, version));
      try {
        while (true) {
          const response = await iterator.next();
          if (response.value) {
            const modification = response.value;
            const value = modification.isDelete || !modification.value?.length
              ? null : JSON.parse(Buffer.from(modification.value).toString('utf8'));
            items.push({
              transactionId: modification.txId,
              timestamp: timestampToIso(modification.timestamp),
              isDelete: Boolean(modification.isDelete),
              recordId,
              version,
              status: value?.status || 'DELETED',
            });
          }
          if (response.done) break;
        }
      } finally { await iterator.close(); }
    }
    items.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.version - right.version);
    return { recordId, items };
  }
}

export const ledgerPrivacy = Object.freeze({
  allowedRegistrationFields: [...REGISTRATION_FIELDS],
  allowedTransactionMetadataFields: [...TRANSACTION_METADATA_FIELDS],
  recordSchema: RECORD_SCHEMA,
});
