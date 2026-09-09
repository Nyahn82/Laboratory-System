import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const EMPTY = Object.freeze({
  schemaVersion: 1,
  registrations: [],
  operations: [],
  transactions: [],
  jobs: [],
  tokens: [],
  verificationReceipts: [],
});

function sameProof(left, right) {
  return left.documentHash === right.documentHash
    && (left.encryptedCidReference || null) === (right.encryptedCidReference || null)
    && left.approvalTimestamp === right.approvalTimestamp
    && left.issuingOrganization === right.issuingOrganization;
}

export class FileVerificationRepository {
  constructor(filename) {
    this.filename = path.resolve(filename);
    this.queue = Promise.resolve();
    this.provider = 'atomic-json';
    this.simulated = true;
  }

  async init() {
    await mkdir(path.dirname(this.filename), { recursive: true });
    try {
      await readFile(this.filename);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.#write(EMPTY);
    }
  }

  async #read() {
    await this.init();
    const state = JSON.parse(await readFile(this.filename, 'utf8'));
    for (const key of ['registrations', 'operations', 'transactions', 'jobs', 'tokens', 'verificationReceipts']) {
      if (!Array.isArray(state[key])) throw new Error('Verification metadata file has an unsupported format.');
    }
    return state;
  }

  async #write(state) {
    await mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.${Date.now()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.filename);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  #locked(operation) {
    const pending = this.queue.then(operation, operation);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async findOperation(idempotencyKey) {
    const state = await this.#read();
    return state.operations.find((item) => item.idempotencyKey === idempotencyKey) || null;
  }

  async getRegistration(recordId, version) {
    const state = await this.#read();
    return state.registrations.find((item) => item.recordId === recordId && item.version === version) || null;
  }

  async getLatestRegistration(recordId) {
    const state = await this.#read();
    return state.registrations
      .filter((item) => item.recordId === recordId)
      .sort((a, b) => b.version - a.version)[0] || null;
  }

  async commitRegistration({ operation, registration, transaction }) {
    return this.#locked(async () => {
      const state = await this.#read();
      const priorOperation = state.operations.find((item) => item.idempotencyKey === operation.idempotencyKey);
      if (priorOperation) return { outcome: priorOperation.fingerprint === operation.fingerprint ? 'duplicate' : 'idempotency-conflict', operation: priorOperation };
      const priorRegistration = state.registrations.find((item) => item.recordId === registration.recordId && item.version === registration.version);
      if (priorRegistration) return { outcome: sameProof(priorRegistration, registration) ? 'version-duplicate' : 'version-conflict', registration: priorRegistration };
      state.registrations.push({ ...registration, id: randomUUID() });
      state.operations.push({ ...operation, id: randomUUID() });
      state.transactions.push({ ...transaction, id: randomUUID() });
      state.jobs.push({ id: randomUUID(), type: 'REGISTER', recordId: registration.recordId, version: registration.version, status: 'SUCCEEDED', attempts: 1, createdAt: registration.registeredAt, completedAt: registration.registeredAt });
      await this.#write(state);
      return { outcome: 'created', registration };
    });
  }

  async commitRelease({ operation, recordId, version, releaseTimestamp, transaction, token }) {
    return this.#locked(async () => {
      const state = await this.#read();
      const priorOperation = state.operations.find((item) => item.idempotencyKey === operation.idempotencyKey);
      if (priorOperation) return { outcome: priorOperation.fingerprint === operation.fingerprint ? 'duplicate' : 'idempotency-conflict', operation: priorOperation };
      const registration = state.registrations.find((item) => item.recordId === recordId && item.version === version);
      if (!registration) return { outcome: 'not-found' };
      if (registration.status === 'REVOKED') return { outcome: 'revoked' };
      if (registration.status === 'RELEASED') return { outcome: 'already-released', registration };
      registration.status = 'RELEASED';
      registration.releaseTimestamp = releaseTimestamp;
      registration.releaseTransactionId = transaction.transactionId;
      state.operations.push({ ...operation, id: randomUUID() });
      state.transactions.push({ ...transaction, id: randomUUID() });
      state.tokens.push({ ...token, id: randomUUID() });
      state.jobs.push({ id: randomUUID(), type: 'RELEASE', recordId, version, status: 'SUCCEEDED', attempts: 1, createdAt: releaseTimestamp, completedAt: releaseTimestamp });
      await this.#write(state);
      return { outcome: 'released', registration };
    });
  }

  async commitRevoke({ operation, recordId, version, reasonCode, revokedAt, transaction }) {
    return this.#locked(async () => {
      const state = await this.#read();
      const priorOperation = state.operations.find((item) => item.idempotencyKey === operation.idempotencyKey);
      if (priorOperation) return { outcome: priorOperation.fingerprint === operation.fingerprint ? 'duplicate' : 'idempotency-conflict', operation: priorOperation };
      const registration = state.registrations.find((item) => item.recordId === recordId && item.version === version);
      if (!registration) return { outcome: 'not-found' };
      if (registration.status === 'REVOKED') return { outcome: 'already-revoked', registration };
      registration.status = 'REVOKED';
      registration.reasonCode = reasonCode;
      registration.revokedAt = revokedAt;
      registration.revokeTransactionId = transaction.transactionId;
      for (const token of state.tokens) {
        if (token.recordId === recordId && token.version === version && token.status === 'ACTIVE') {
          token.status = 'REVOKED';
          token.revokedAt = revokedAt;
        }
      }
      state.operations.push({ ...operation, id: randomUUID() });
      state.transactions.push({ ...transaction, id: randomUUID() });
      state.jobs.push({ id: randomUUID(), type: 'REVOKE', recordId, version, status: 'SUCCEEDED', attempts: 1, createdAt: revokedAt, completedAt: revokedAt });
      await this.#write(state);
      return { outcome: 'revoked', registration };
    });
  }

  async findToken(tokenDigest) {
    const state = await this.#read();
    return state.tokens.find((item) => item.tokenDigest === tokenDigest) || null;
  }

  async recordVerification(entry) {
    return this.#locked(async () => {
      const state = await this.#read();
      state.verificationReceipts.push({ id: randomUUID(), ...entry });
      await this.#write(state);
    });
  }

  async listJobs({ limit = 50, status } = {}) {
    const state = await this.#read();
    return state.jobs.filter((job) => !status || job.status === status).slice(-limit).reverse();
  }

  async health() {
    try {
      await this.#read();
      return { ok: true, provider: this.provider, simulated: true };
    } catch {
      return { ok: false, provider: this.provider, simulated: true };
    }
  }

  async close() {}
}
