import { StorageError } from '../errors.js';

function normalize(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new StorageError(400, 'Records may contain only finite numbers.', 'INVALID_CANONICAL_JSON');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new StorageError(400, 'Records may not contain circular references.', 'INVALID_CANONICAL_JSON');
    seen.add(value);
    const result = value.map((item) => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
        throw new StorageError(400, 'Records must contain JSON-compatible values only.', 'INVALID_CANONICAL_JSON');
      }
      return normalize(item, seen);
    });
    seen.delete(value);
    return result;
  }
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new StorageError(400, 'Records must contain plain JSON objects only.', 'INVALID_CANONICAL_JSON');
    }
    if (seen.has(value)) throw new StorageError(400, 'Records may not contain circular references.', 'INVALID_CANONICAL_JSON');
    seen.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
        throw new StorageError(400, 'Records must contain JSON-compatible values only.', 'INVALID_CANONICAL_JSON');
      }
      result[key] = normalize(item, seen);
    }
    seen.delete(value);
    return result;
  }
  throw new StorageError(400, 'Records must contain JSON-compatible values only.', 'INVALID_CANONICAL_JSON');
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value, new WeakSet()));
}
