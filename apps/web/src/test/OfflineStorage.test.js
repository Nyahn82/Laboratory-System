import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { offlineDb } from '../offline/indexedDb.js';
let openRequest;
let transaction;
let operation;
let db;
beforeEach(() => {
  vi.useFakeTimers();
  openRequest = {};
  operation = { result: 'saved' };
  transaction = { objectStore: () => ({ put: () => operation }), abort: vi.fn() };
  db = { close: vi.fn(), transaction: () => transaction };
  vi.stubGlobal('indexedDB', { open: () => openRequest });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function openStore() { const promise = offlineDb.saveDraft('patient', {}); openRequest.result = db; openRequest.onsuccess(); await Promise.resolve(); return { promise }; }
describe('bounded offline storage', () => {
  it('rejects a blocked database open and closes a late connection', async () => {
    const promise = offlineDb.saveDraft('patient', {});
    const assertion = expect(promise).rejects.toThrow(/blocked/);
    openRequest.onblocked(); await assertion;
    openRequest.result = db; openRequest.onsuccess();
    expect(db.close).toHaveBeenCalled();
  });
  it('times out a database that never opens', async () => {
    const assertion = expect(offlineDb.saveDraft('patient', {})).rejects.toThrow(/did not respond/);
    await vi.advanceTimersByTimeAsync(5000); await assertion;
  });
  it('resolves only after the transaction commits', async () => {
    const { promise } = await openStore(); const resolved = vi.fn(); promise.then(resolved);
    operation.onsuccess?.(); await Promise.resolve(); expect(resolved).not.toHaveBeenCalled();
    transaction.oncomplete(); await expect(promise).resolves.toBe('saved'); expect(db.close).toHaveBeenCalled();
  });
  it('rejects a transaction abort instead of hanging', async () => {
    const { promise } = await openStore(); const assertion = expect(promise).rejects.toThrow(/aborted/);
    transaction.onabort(); await assertion;
  });
  it('aborts stalled writes', async () => {
    const { promise } = await openStore(); const assertion = expect(promise).rejects.toThrow(/did not respond/);
    await vi.advanceTimersByTimeAsync(5000); await assertion; expect(transaction.abort).toHaveBeenCalled();
  });
});
