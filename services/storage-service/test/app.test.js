import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { FileObjectStore } from '../src/adapters/file-object-store.js';
import { FileStorageRepository } from '../src/repositories/file-storage-repository.js';
import { PackageService } from '../src/services/package-service.js';

describe('storage HTTP API', () => {
  let directory;
  let app;
  let repository;
  let objectStore;
  const token = 'internal-test-token-at-least-16';

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'labchain-storage-'));
    repository = new FileStorageRepository(path.join(directory, 'metadata.json'));
    objectStore = new FileObjectStore(path.join(directory, 'objects'));
    await Promise.all([repository.init(), objectStore.init()]);
    const packageService = new PackageService({ repository, objectStore, masterKey: randomBytes(32), masterKeyId: 'test-master' });
    app = createApp({
      config: { internalServiceToken: token, maxJsonBytes: 1_000_000 },
      packageService,
      repository,
      objectStore,
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const headers = (call, key = 'idem-storage-0001') => call
    .set('X-Internal-Service-Token', token)
    .set('X-Caller-Service', 'records-service')
    .set('Idempotency-Key', key);

  it('reports health and explicit simulated readiness', async () => {
    expect((await request(app).get('/health')).body.success).toBe(true);
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data.dependencies.objectStorage.simulated).toBe(true);
  });

  it('requires internal authentication', async () => {
    expect((await request(app).post('/packages').send({})).status).toBe(401);
  });

  it('creates, retrieves, verifies, and deduplicates an encrypted package', async () => {
    const body = { recordId: 'opaque-record-0001', version: 1, record: { patientName: 'Synthetic Only', results: [{ code: 'HGB', value: 15 }] } };
    const created = await headers(request(app).post('/packages')).send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.envelopeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.body.data.protectedObjectReference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.body.data.protectedObjectReference).not.toBe(created.body.data.objectReference);

    const duplicate = await headers(request(app).post('/packages')).send(body);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.duplicate).toBe(true);
    expect(duplicate.body.data.protectedObjectReference).toBe(created.body.data.protectedObjectReference);

    const retrieved = await request(app)
      .get('/packages/opaque-record-0001/versions/1')
      .set('X-Internal-Service-Token', token)
      .set('X-Caller-Service', 'records-service');
    expect(retrieved.status).toBe(200);
    expect(retrieved.body.data.record).toEqual(body.record);

    const verified = await request(app)
      .post('/packages/opaque-record-0001/versions/1/verify')
      .set('X-Internal-Service-Token', token)
      .set('X-Caller-Service', 'records-service');
    expect(verified.body.data.verified).toBe(true);

    const objectBytes = await readFile(path.join(directory, 'objects', `${created.body.data.envelopeHash}.enc`), 'utf8');
    const metadataBytes = await readFile(path.join(directory, 'metadata.json'), 'utf8');
    expect(objectBytes).not.toContain('Synthetic Only');
    expect(objectBytes).not.toContain('HGB');
    expect(metadataBytes).not.toContain('Synthetic Only');
    expect(metadataBytes).not.toContain('HGB');
  });

  it('rejects idempotency reuse with different plaintext', async () => {
    const first = { recordId: 'opaque-record-0001', version: 1, record: { state: 'approved' } };
    const second = { ...first, record: { state: 'different' } };
    expect((await headers(request(app).post('/packages')).send(first)).status).toBe(201);
    const conflict = await headers(request(app).post('/packages')).send(second);
    expect(conflict.status).toBe(409);
    expect(conflict.body.data).toEqual({});
  });

  it('rejects tampered encrypted bytes during verification', async () => {
    const created = await headers(request(app).post('/packages')).send({ recordId: 'opaque-record-0001', version: 1, record: { safe: true } });
    const file = path.join(directory, 'objects', `${created.body.data.envelopeHash}.enc`);
    const bytes = Buffer.from(await readFile(file));
    bytes[10] ^= 1;
    await import('node:fs/promises').then(({ writeFile }) => writeFile(file, bytes));
    const response = await request(app)
      .post('/packages/opaque-record-0001/versions/1/verify')
      .set('X-Internal-Service-Token', token);
    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
  });
});
