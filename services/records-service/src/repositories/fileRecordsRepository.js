import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInitialState } from './seedData.js';

export class FileRecordsRepository {
  constructor({ filePath, seedFactory = createInitialState }) {
    this.filePath = filePath;
    this.seedFactory = seedFactory;
    this.state = null;
    this.queue = Promise.resolve();
  }

  async initialize() {
    if (this.state) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.state = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = this.seedFactory();
      await this.#persist(this.state);
    }
  }

  async snapshot() {
    await this.initialize();
    await this.queue;
    return structuredClone(this.state);
  }

  async transact(mutator) {
    await this.initialize();
    const run = async () => {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      draft.revision = (draft.revision || 0) + 1;
      await this.#persist(draft);
      this.state = draft;
      return structuredClone(result);
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async replace(state) {
    await this.initialize();
    return this.transact((draft) => {
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, structuredClone(state));
      return { revision: draft.revision };
    });
  }

  async ping() {
    await this.initialize();
    return { ok: true, driver: 'file', simulated: true, filePath: this.filePath, revision: this.state.revision || 0 };
  }

  async close() {}

  async #persist(state) {
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
