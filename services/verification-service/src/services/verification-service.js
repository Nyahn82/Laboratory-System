import { createHash, createHmac, randomBytes } from 'node:crypto';
import { canonicalJson } from '@rhu-labchain/service-kit';
import { VerificationError } from '../errors.js';

function digestToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function addDays(isoTimestamp, days) {
  const date = new Date(isoTimestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function transactionReceipt(ledger, result, operationType, recordId, version, committedAt) {
  return {
    recordId,
    version,
    operationType,
    transactionId: result.transactionId,
    ledgerProvider: ledger.provider,
    simulated: ledger.simulated,
    committedAt,
  };
}

function registrationDto(value, duplicate = false) {
  return {
    recordId: value.recordId,
    version: value.version,
    documentHash: value.documentHash,
    encryptedCidReference: value.encryptedCidReference || null,
    approvalTimestamp: value.approvalTimestamp,
    issuingOrganization: value.issuingOrganization,
    status: value.status,
    transactionId: value.registrationTransactionId,
    ledgerProvider: value.ledgerProvider,
    simulated: Boolean(value.simulated),
    registeredAt: value.registeredAt,
    releaseTimestamp: value.releaseTimestamp || null,
    duplicate,
  };
}

export class VerificationService {
  constructor({ repository, ledger, qrTokenSecret, publicBaseUrl, qrTokenTtlDays = 365, now = () => new Date().toISOString(), random = randomBytes }) {
    this.repository = repository;
    this.ledger = ledger;
    this.qrTokenSecret = qrTokenSecret;
    this.publicBaseUrl = publicBaseUrl;
    this.qrTokenTtlDays = qrTokenTtlDays;
    this.now = now;
    this.random = random;
  }

  #fingerprint(operationType, payload) {
    return createHmac('sha256', this.qrTokenSecret).update(operationType).update('\0').update(canonicalJson(payload)).digest('hex');
  }

  #qrToken(idempotencyKey, fingerprint) {
    // A keyed derivation is opaque and reproducible. This lets a safe retry return
    // the same token without ever storing the bearer token itself.
    return createHmac('sha256', this.qrTokenSecret)
      .update('rhu-labchain.qr-token/v1')
      .update('\0')
      .update(idempotencyKey)
      .update('\0')
      .update(fingerprint)
      .digest('base64url');
  }

  async #priorOperation(idempotencyKey, fingerprint) {
    const prior = await this.repository.findOperation(idempotencyKey);
    if (!prior) return null;
    if (prior.fingerprint !== fingerprint) throw new VerificationError(409, 'The idempotency key was already used for another operation.', 'IDEMPOTENCY_CONFLICT');
    if (prior.operationType === 'RELEASE') {
      const token = this.#qrToken(idempotencyKey, fingerprint);
      return {
        ...prior.response,
        duplicate: true,
        qrToken: token,
        verificationToken: token,
        token,
        verificationUrl: `${this.publicBaseUrl}/verify/${token}`,
      };
    }
    return { ...prior.response, duplicate: true };
  }

  async register(payload, idempotencyKey) {
    payload = { ...payload, approvalTimestamp: new Date(payload.approvalTimestamp).toISOString() };
    const fingerprint = this.#fingerprint('REGISTER', payload);
    const prior = await this.#priorOperation(idempotencyKey, fingerprint);
    if (prior) return prior;

    const existing = await this.repository.getRegistration(payload.recordId, payload.version);
    if (existing) {
      const sameProof = existing.documentHash === payload.documentHash
        && (existing.encryptedCidReference || null) === (payload.encryptedCidReference || null)
        && existing.approvalTimestamp === payload.approvalTimestamp
        && existing.issuingOrganization === payload.issuingOrganization;
      if (!sameProof) throw new VerificationError(409, 'This ledger version is immutable.', 'LEDGER_VERSION_CONFLICT');
      return registrationDto({ ...existing, ledgerProvider: this.ledger.provider, simulated: this.ledger.simulated }, true);
    }
    const latest = await this.repository.getLatestRegistration(payload.recordId);
    if (latest && payload.version !== latest.version + 1) {
      throw new VerificationError(409, 'Record versions must be registered sequentially.', 'LEDGER_VERSION_SEQUENCE_INVALID');
    }
    if (!latest && payload.version !== 1) {
      throw new VerificationError(409, 'The first ledger registration must be version 1.', 'LEDGER_VERSION_SEQUENCE_INVALID');
    }

    const committedAt = this.now();
    const ledgerResult = latest
      ? await this.ledger.registerRecordVersion(payload)
      : await this.ledger.registerRecord(payload);
    const registration = {
      ...payload,
      status: 'REGISTERED',
      registrationTransactionId: ledgerResult.transactionId,
      ledgerProvider: this.ledger.provider,
      simulated: this.ledger.simulated,
      registeredAt: committedAt,
    };
    const response = registrationDto(registration);
    const operation = { idempotencyKey, fingerprint, operationType: 'REGISTER', response };
    const result = await this.repository.commitRegistration({
      operation,
      registration,
      transaction: transactionReceipt(this.ledger, ledgerResult, 'REGISTER', payload.recordId, payload.version, committedAt),
    });
    if (result.outcome === 'idempotency-conflict') throw new VerificationError(409, 'The idempotency key was already used for another operation.', 'IDEMPOTENCY_CONFLICT');
    if (result.outcome === 'version-conflict') throw new VerificationError(409, 'This ledger version is immutable.', 'LEDGER_VERSION_CONFLICT');
    if (result.outcome === 'version-duplicate') {
      return registrationDto({ ...result.registration, ledgerProvider: this.ledger.provider, simulated: this.ledger.simulated }, true);
    }
    return result.outcome === 'duplicate' ? { ...result.operation.response, duplicate: true } : response;
  }

  async release({ recordId, version, releaseTimestamp }, idempotencyKey) {
    releaseTimestamp = new Date(releaseTimestamp).toISOString();
    const payload = { recordId, version, releaseTimestamp };
    const fingerprint = this.#fingerprint('RELEASE', payload);
    const prior = await this.#priorOperation(idempotencyKey, fingerprint);
    if (prior) return prior;
    const registration = await this.repository.getRegistration(recordId, version);
    if (!registration) throw new VerificationError(404, 'Ledger registration was not found.', 'LEDGER_RECORD_NOT_FOUND');
    if (registration.status === 'REVOKED') throw new VerificationError(409, 'A revoked record cannot be released.', 'LEDGER_RECORD_REVOKED');
    if (registration.status === 'RELEASED') throw new VerificationError(409, 'This record version is already released.', 'LEDGER_RECORD_ALREADY_RELEASED');
    if (new Date(releaseTimestamp).getTime() < new Date(registration.approvalTimestamp).getTime()) {
      throw new VerificationError(409, 'Release timestamp cannot precede approval.', 'LEDGER_RELEASE_SEQUENCE_INVALID');
    }

    const ledgerResult = await this.ledger.releaseRecord(recordId, version, releaseTimestamp);
    const token = this.#qrToken(idempotencyKey, fingerprint);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Secure QR token generation failed.');
    const tokenMetadata = {
      tokenDigest: digestToken(token),
      recordId,
      version,
      status: 'ACTIVE',
      createdAt: releaseTimestamp,
      expiresAt: addDays(releaseTimestamp, this.qrTokenTtlDays),
    };
    const safeResponse = {
      recordId,
      version,
      status: 'RELEASED',
      releaseTimestamp,
      transactionId: ledgerResult.transactionId,
      ledgerProvider: this.ledger.provider,
      simulated: this.ledger.simulated,
    };
    const operation = { idempotencyKey, fingerprint, operationType: 'RELEASE', response: safeResponse };
    const result = await this.repository.commitRelease({
      operation,
      recordId,
      version,
      releaseTimestamp,
      transaction: transactionReceipt(this.ledger, ledgerResult, 'RELEASE', recordId, version, releaseTimestamp),
      token: tokenMetadata,
    });
    if (result.outcome === 'idempotency-conflict') throw new VerificationError(409, 'The idempotency key was already used for another operation.', 'IDEMPOTENCY_CONFLICT');
    if (result.outcome === 'not-found') throw new VerificationError(404, 'Ledger registration was not found.', 'LEDGER_RECORD_NOT_FOUND');
    if (result.outcome === 'revoked') throw new VerificationError(409, 'A revoked record cannot be released.', 'LEDGER_RECORD_REVOKED');
    if (result.outcome === 'already-released') throw new VerificationError(409, 'This record version is already released.', 'LEDGER_RECORD_ALREADY_RELEASED');
    if (result.outcome === 'duplicate') return {
      ...result.operation.response,
      duplicate: true,
      qrToken: token,
      verificationToken: token,
      token,
      verificationUrl: `${this.publicBaseUrl}/verify/${token}`,
    };
    return {
      ...safeResponse,
      duplicate: false,
      qrToken: token,
      verificationToken: token,
      token,
      verificationUrl: `${this.publicBaseUrl}/verify/${token}`,
      tokenExpiresAt: tokenMetadata.expiresAt,
    };
  }

  async revoke({ recordId, version, reasonCode, revokedAt }, idempotencyKey) {
    revokedAt = new Date(revokedAt).toISOString();
    const payload = { recordId, version, reasonCode, revokedAt };
    const fingerprint = this.#fingerprint('REVOKE', payload);
    const prior = await this.#priorOperation(idempotencyKey, fingerprint);
    if (prior) return prior;
    const registration = await this.repository.getRegistration(recordId, version);
    if (!registration) throw new VerificationError(404, 'Ledger registration was not found.', 'LEDGER_RECORD_NOT_FOUND');
    if (registration.status === 'REVOKED') throw new VerificationError(409, 'This record proof is already revoked.', 'LEDGER_RECORD_ALREADY_REVOKED');
    const ledgerResult = await this.ledger.revokeRecord(recordId, version, reasonCode, revokedAt);
    const response = {
      recordId,
      version,
      status: 'REVOKED',
      reasonCode,
      revokedAt,
      transactionId: ledgerResult.transactionId,
      ledgerProvider: this.ledger.provider,
      simulated: this.ledger.simulated,
    };
    const operation = { idempotencyKey, fingerprint, operationType: 'REVOKE', response };
    const result = await this.repository.commitRevoke({
      operation,
      recordId,
      version,
      reasonCode,
      revokedAt,
      transaction: transactionReceipt(this.ledger, ledgerResult, 'REVOKE', recordId, version, revokedAt),
    });
    if (result.outcome === 'idempotency-conflict') throw new VerificationError(409, 'The idempotency key was already used for another operation.', 'IDEMPOTENCY_CONFLICT');
    if (result.outcome === 'not-found') throw new VerificationError(404, 'Ledger registration was not found.', 'LEDGER_RECORD_NOT_FOUND');
    if (result.outcome === 'already-revoked') throw new VerificationError(409, 'This record proof is already revoked.', 'LEDGER_RECORD_ALREADY_REVOKED');
    return result.outcome === 'duplicate' ? { ...result.operation.response, duplicate: true } : response;
  }

  async history(recordId) {
    const items = await this.ledger.getRecordHistory(recordId);
    return { recordId, ledgerProvider: this.ledger.provider, simulated: this.ledger.simulated, items: Array.isArray(items) ? items : items?.items || [] };
  }

  async publicVerify(token, requestContext) {
    const tokenDigest = digestToken(token);
    const tokenRecord = await this.repository.findToken(tokenDigest);
    if (!tokenRecord) {
      await this.repository.recordVerification({ tokenId: null, recordId: null, version: null, outcome: 'NOT_FOUND', requestId: requestContext.requestId, source: requestContext.source, occurredAt: this.now() }).catch(() => {});
      return { valid: false, status: 'NOT_VERIFIED' };
    }
    const expired = new Date(tokenRecord.expiresAt).getTime() <= Date.now();
    if (tokenRecord.status !== 'ACTIVE' || expired) {
      const status = tokenRecord.status === 'REVOKED' ? 'REVOKED' : 'EXPIRED';
      await this.repository.recordVerification({ tokenId: tokenRecord.id, recordId: tokenRecord.recordId, version: tokenRecord.version, outcome: status, requestId: requestContext.requestId, source: requestContext.source, occurredAt: this.now() }).catch(() => {});
      return { valid: false, status };
    }
    const registration = await this.repository.getRegistration(tokenRecord.recordId, tokenRecord.version);
    if (!registration) return { valid: false, status: 'NOT_VERIFIED' };
    const ledgerCheck = await this.ledger.verifyRecord(registration.recordId, registration.version, registration.documentHash);
    const valid = Boolean(ledgerCheck?.valid && registration.status === 'RELEASED');
    await this.repository.recordVerification({ tokenId: tokenRecord.id, recordId: registration.recordId, version: registration.version, outcome: valid ? 'VALID' : 'INVALID', requestId: requestContext.requestId, source: requestContext.source, occurredAt: this.now() }).catch(() => {});
    const publicRecord = valid ? {
      opaqueRecordId: registration.recordId,
      version: registration.version,
      status: 'VERIFIED',
      issuingOrganization: registration.issuingOrganization,
      approvalTimestamp: registration.approvalTimestamp,
      releaseTimestamp: registration.releaseTimestamp,
      releasedAt: registration.releaseTimestamp,
      ledger: this.ledger.simulated ? 'Development adapter' : 'Hyperledger Fabric',
    } : undefined;
    return {
      valid,
      status: valid ? 'VERIFIED' : 'NOT_VERIFIED',
      ...(publicRecord || {}),
      record: publicRecord,
    };
  }
}
