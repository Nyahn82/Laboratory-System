import { createRequestId } from '../utils/requestId.js';

const DB_NAME = 'rhu-labchain-offline';
const DB_VERSION = 1;
const STORAGE_TIMEOUT_MS = 5000;

function openDatabase() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, db) => {
      if (settled) { db?.close(); return; }
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(db);
    };
    const timer = setTimeout(() => finish(new Error('Local storage did not respond.')), STORAGE_TIMEOUT_MS);
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (error) { finish(error); return; }
    request.onupgradeneeded = () => {
      if (settled) { request.transaction.abort(); return; }
      const db = request.result;
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) {
        const store = db.createObjectStore('outbox', { keyPath: 'id' });
        store.createIndex('status', 'status');
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      finish(null, request.result);
    };
    request.onerror = () => finish(request.error || new Error('Local storage could not be opened.'));
    request.onblocked = () => finish(new Error('Local storage is blocked by another tab.'));
  });
}

async function withStore(name, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx;
    let request;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      db.close();
      if (error) reject(error);
      else resolve(request.result);
    };
    const timer = setTimeout(() => {
      try { tx?.abort(); } catch {}
      finish(new Error('Local storage did not respond.'));
    }, STORAGE_TIMEOUT_MS);
    try {
      tx = db.transaction(name, mode);
      tx.oncomplete = () => finish();
      tx.onabort = () => finish(tx.error || new Error('Local storage transaction was aborted.'));
      tx.onerror = () => finish(tx.error || new Error('Local storage transaction failed.'));
      request = operation(tx.objectStore(name));
      request.onerror = () => { try { tx.abort(); } catch {} finish(request.error || new Error('Local storage operation failed.')); };
    } catch (error) {
      try { tx?.abort(); } catch {}
      finish(error);
    }
  });
}

export const offlineDb = {
  saveDraft(type, payload, id = `${type}:current`) {
    return withStore('drafts', 'readwrite', (store) => store.put({ id, type, payload, updatedAt: new Date().toISOString() }));
  },
  getDraft(id) {
    return withStore('drafts', 'readonly', (store) => store.get(id));
  },
  deleteDraft(id) {
    return withStore('drafts', 'readwrite', (store) => store.delete(id));
  },
  queue(path, method, body, idempotencyKey = createRequestId()) {
    const entry = {
      id: createRequestId(),
      idempotencyKey,
      path,
      method,
      body,
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    };
    return withStore('outbox', 'readwrite', (store) => store.add(entry)).then(() => entry);
  },
  listOutbox() {
    return withStore('outbox', 'readonly', (store) => store.getAll());
  },
  putOutbox(entry) {
    return withStore('outbox', 'readwrite', (store) => store.put(entry));
  },
  removeOutbox(id) {
    return withStore('outbox', 'readwrite', (store) => store.delete(id));
  },
  async clearPrivateData() {
    await withStore('drafts', 'readwrite', (store) => store.clear());
  },
};

