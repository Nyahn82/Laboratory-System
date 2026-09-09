import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = Object.freeze({ schemaVersion: 1, versions: [], jobs: [], retrievalAudit: [] });

export class FileStorageRepository {
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
    if (state.schemaVersion !== 1 || !Array.isArray(state.versions) || !Array.isArray(state.jobs) || !Array.isArray(state.retrievalAudit)) {
      throw new Error('Storage metadata file has an unsupported format.');
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

  async findByIdempotencyKey(key) {
    const state = await this.#read();
    return state.versions.find((item) => item.idempotencyKey === key) || null;
  }

  async findVersion(recordId, version) {
    const state = await this.#read();
    return state.versions.find((item) => item.recordId === recordId && item.version === version) || null;
  }

  async commitPackage(metadata) {
    return this.#locked(async () => {
      const state = await this.#read();
      const byKey = state.versions.find((item) => item.idempotencyKey === metadata.idempotencyKey);
      if (byKey) return { outcome: byKey.requestFingerprint === metadata.requestFingerprint ? 'duplicate' : 'idempotency-conflict', value: byKey };
      const byVersion = state.versions.find((item) => item.recordId === metadata.recordId && item.version === metadata.version);
      if (byVersion) return { outcome: byVersion.requestFingerprint === metadata.requestFingerprint ? 'duplicate' : 'version-conflict', value: byVersion };
      const value = { ...metadata, id: randomUUID() };
      state.versions.push(value);
      state.jobs.push({
        id: randomUUID(),
        type: 'PACKAGE_CREATE',
        recordId: value.recordId,
        version: value.version,
        status: 'SUCCEEDED',
        attempts: 1,
        createdAt: value.createdAt,
        completedAt: value.createdAt,
      });
      await this.#write(state);
      return { outcome: 'created', value };
    });
  }

  async recordRetrieval(entry) {
    return this.#locked(async () => {
      const state = await this.#read();
      state.retrievalAudit.push({ id: randomUUID(), ...entry });
      await this.#write(state);
    });
  }

  async listJobs({ limit = 50, status } = {}) {
    const state = await this.#read();
    return state.jobs
      .filter((job) => !status || job.status === status)
      .slice(-limit)
      .reverse();
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
