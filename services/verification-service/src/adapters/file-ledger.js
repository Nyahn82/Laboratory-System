import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '@rhu-labchain/service-kit';
import { VerificationError } from '../errors.js';

const EMPTY = Object.freeze({ schemaVersion: 1, warning: 'SIMULATED DEVELOPMENT LEDGER - NOT HYPERLEDGER FABRIC', events: [] });

export class FileLedger {
  constructor(filename, now = () => new Date().toISOString()) {
    this.filename = path.resolve(filename);
    this.now = now;
    this.queue = Promise.resolve();
    this.provider = 'development-file-ledger';
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
    if (state.schemaVersion !== 1 || !Array.isArray(state.events)) throw new Error('Development ledger file has an unsupported format.');
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

  #transactionId(event) {
    return `dev-${createHash('sha256').update(canonicalJson(event)).update(randomUUID()).digest('hex')}`;
  }

  #materialize(events, recordId, version) {
    let record = null;
    for (const event of events) {
      if (event.recordId !== recordId || event.version !== version) continue;
      if (event.type === 'REGISTER') record = { ...event.payload, status: 'REGISTERED', registeredAt: event.timestamp };
      if (event.type === 'RELEASE' && record) record = { ...record, status: 'RELEASED', releaseTimestamp: event.releaseTimestamp };
      if (event.type === 'REVOKE' && record) record = { ...record, status: 'REVOKED', revokedAt: event.revokedAt, reasonCode: event.reasonCode };
    }
    return record;
  }

  async #register(payload, functionName) {
    return this.#locked(async () => {
      const state = await this.#read();
      const existing = this.#materialize(state.events, payload.recordId, payload.version);
      if (existing) {
        if (existing.documentHash !== payload.documentHash) throw new VerificationError(409, 'Ledger version already exists with a different hash.', 'LEDGER_VERSION_CONFLICT');
        const original = state.events.find((event) => event.type === 'REGISTER' && event.recordId === payload.recordId && event.version === payload.version);
        return { transactionId: original.transactionId, record: existing, duplicate: true, simulated: true };
      }
      const event = { type: 'REGISTER', functionName, recordId: payload.recordId, version: payload.version, payload, timestamp: this.now() };
      event.transactionId = this.#transactionId(event);
      state.events.push(event);
      await this.#write(state);
      return { transactionId: event.transactionId, record: this.#materialize(state.events, payload.recordId, payload.version), duplicate: false, simulated: true };
    });
  }

  registerRecord(payload) {
    return this.#register(payload, 'RegisterRecord');
  }

  registerRecordVersion(payload) {
    return this.#register(payload, 'RegisterRecordVersion');
  }

  async releaseRecord(recordId, version, releaseTimestamp) {
    return this.#locked(async () => {
      const state = await this.#read();
      const existing = this.#materialize(state.events, recordId, version);
      if (!existing) throw new VerificationError(404, 'Ledger record version was not found.', 'LEDGER_RECORD_NOT_FOUND');
      if (existing.status === 'REVOKED') throw new VerificationError(409, 'A revoked ledger record cannot be released.', 'LEDGER_RECORD_REVOKED');
      if (existing.status === 'RELEASED') {
        const prior = state.events.find((event) => event.type === 'RELEASE' && event.recordId === recordId && event.version === version);
        return { transactionId: prior.transactionId, record: existing, duplicate: true, simulated: true };
      }
      const event = { type: 'RELEASE', functionName: 'ReleaseRecord', recordId, version, releaseTimestamp, timestamp: this.now() };
      event.transactionId = this.#transactionId(event);
      state.events.push(event);
      await this.#write(state);
      return { transactionId: event.transactionId, record: this.#materialize(state.events, recordId, version), duplicate: false, simulated: true };
    });
  }

  async revokeRecord(recordId, version, reasonCode, revokedAt) {
    return this.#locked(async () => {
      const state = await this.#read();
      const existing = this.#materialize(state.events, recordId, version);
      if (!existing) throw new VerificationError(404, 'Ledger record version was not found.', 'LEDGER_RECORD_NOT_FOUND');
      if (existing.status === 'REVOKED') {
        const prior = state.events.find((event) => event.type === 'REVOKE' && event.recordId === recordId && event.version === version);
        return { transactionId: prior.transactionId, record: existing, duplicate: true, simulated: true };
      }
      const event = { type: 'REVOKE', functionName: 'RevokeRecord', recordId, version, reasonCode, revokedAt, timestamp: this.now() };
      event.transactionId = this.#transactionId(event);
      state.events.push(event);
      await this.#write(state);
      return { transactionId: event.transactionId, record: this.#materialize(state.events, recordId, version), duplicate: false, simulated: true };
    });
  }

  async getRecord(recordId, version) {
    const state = await this.#read();
    return this.#materialize(state.events, recordId, version);
  }

  async getRecordHistory(recordId) {
    const state = await this.#read();
    return state.events.filter((event) => event.recordId === recordId).map((event) => ({
      transactionId: event.transactionId,
      type: event.type,
      recordId: event.recordId,
      version: event.version,
      timestamp: event.timestamp,
      status: event.type === 'REGISTER' ? 'REGISTERED' : event.type === 'RELEASE' ? 'RELEASED' : 'REVOKED',
    }));
  }

  async verifyRecord(recordId, version, documentHash) {
    const record = await this.getRecord(recordId, version);
    return { valid: Boolean(record && record.documentHash === documentHash && record.status !== 'REVOKED'), record, simulated: true };
  }

  async health() {
    try {
      await this.#read();
      return { ok: true, provider: this.provider, simulated: true, warning: EMPTY.warning };
    } catch {
      return { ok: false, provider: this.provider, simulated: true, warning: EMPTY.warning };
    }
  }

  async close() {}
}
