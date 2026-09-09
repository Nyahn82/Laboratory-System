import { StorageError } from '../errors.js';
import { sha256Buffer } from '../crypto/envelope.js';

export class IpfsObjectStore {
  constructor(apiUrl, fetchImplementation = globalThis.fetch) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.fetch = fetchImplementation;
    this.provider = 'private-ipfs';
    this.simulated = false;
  }

  async init() {}

  async put(bytes, expectedHash) {
    if (sha256Buffer(bytes) !== expectedHash) throw new StorageError(422, 'Object bytes changed before storage.', 'INTEGRITY_CHECK_FAILED');
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), 'encrypted-record.bin');
    let response;
    try {
      response = await this.fetch(`${this.apiUrl}/api/v0/add?pin=true&cid-version=1&raw-leaves=true&quieter=true`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new StorageError(503, 'Private IPFS is unavailable.', 'IPFS_UNAVAILABLE');
    }
    if (!response.ok) throw new StorageError(503, 'Private IPFS rejected the encrypted object.', 'IPFS_ADD_FAILED');
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text.trim().split(/\r?\n/).at(-1));
    } catch {
      throw new StorageError(503, 'Private IPFS returned an invalid receipt.', 'IPFS_RECEIPT_INVALID');
    }
    const cid = result.Hash;
    if (typeof cid !== 'string' || !/^[A-Za-z0-9]+$/.test(cid)) {
      throw new StorageError(503, 'Private IPFS returned an invalid CID.', 'IPFS_RECEIPT_INVALID');
    }
    return { objectReference: cid, sizeBytes: bytes.length, provider: this.provider };
  }

  async get(objectReference) {
    if (typeof objectReference !== 'string' || !/^[A-Za-z0-9]+$/.test(objectReference)) {
      throw new StorageError(500, 'Stored CID is invalid.', 'OBJECT_REFERENCE_INVALID');
    }
    let response;
    try {
      response = await this.fetch(`${this.apiUrl}/api/v0/cat?arg=${encodeURIComponent(objectReference)}`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new StorageError(503, 'Private IPFS is unavailable.', 'IPFS_UNAVAILABLE');
    }
    if (!response.ok) throw new StorageError(503, 'The encrypted IPFS object is unavailable.', 'OBJECT_UNAVAILABLE');
    return Buffer.from(await response.arrayBuffer());
  }

  async health() {
    try {
      const response = await this.fetch(`${this.apiUrl}/api/v0/id`, {
        method: 'POST',
        signal: AbortSignal.timeout(3_000),
      });
      return { ok: response.ok, provider: this.provider, simulated: false };
    } catch {
      return { ok: false, provider: this.provider, simulated: false };
    }
  }
}
