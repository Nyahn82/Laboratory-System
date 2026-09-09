import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { IntegrityError, StorageError } from '../errors.js';
import { sha256Buffer } from '../crypto/envelope.js';

export class FileObjectStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.provider = 'filesystem';
    this.simulated = true;
  }

  async init() {
    await mkdir(this.directory, { recursive: true });
  }

  async put(bytes, expectedHash) {
    await this.init();
    const actualHash = sha256Buffer(bytes);
    if (actualHash !== expectedHash) throw new IntegrityError('Object bytes changed before storage.');
    const objectReference = `file-${actualHash}`;
    const target = path.join(this.directory, `${actualHash}.enc`);
    const temporary = path.join(this.directory, `.${actualHash}.${process.pid}.${Date.now()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await rename(temporary, target);
      } catch (error) {
        if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
        const existing = await readFile(target);
        if (sha256Buffer(existing) !== actualHash) throw new IntegrityError('An existing object has an unexpected hash.');
        await rm(temporary, { force: true });
      }
    } finally {
      if (handle) await handle.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
    }
    return { objectReference, sizeBytes: bytes.length, provider: this.provider };
  }

  async get(objectReference) {
    const match = /^file-([a-f0-9]{64})$/.exec(objectReference);
    if (!match) throw new StorageError(500, 'Stored object reference is invalid.', 'OBJECT_REFERENCE_INVALID');
    try {
      return await readFile(path.join(this.directory, `${match[1]}.enc`));
    } catch (error) {
      if (error.code === 'ENOENT') throw new StorageError(503, 'The encrypted object is unavailable.', 'OBJECT_UNAVAILABLE');
      throw error;
    }
  }

  async health() {
    try {
      await this.init();
      return { ok: true, provider: this.provider, simulated: true };
    } catch {
      return { ok: false, provider: this.provider, simulated: true };
    }
  }
}
