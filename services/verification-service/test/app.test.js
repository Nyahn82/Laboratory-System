import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { FileLedger } from '../src/adapters/file-ledger.js';
import { FileVerificationRepository } from '../src/repositories/file-verification-repository.js';
import { VerificationService } from '../src/services/verification-service.js';

describe('verification HTTP API', () => {
  let directory;
  let metadataFile;
  let app;
  let repository;
  let ledger;
  const internalToken = 'verification-internal-token-123';
  const approvalTimestamp = new Date(Date.now() - 60_000).toISOString();

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'labchain-verification-'));
    metadataFile = path.join(directory, 'metadata.json');
    repository = new FileVerificationRepository(metadataFile);
    ledger = new FileLedger(path.join(directory, 'ledger.json'));
    await Promise.all([repository.init(), ledger.init()]);
    const verificationService = new VerificationService({
      repository,
      ledger,
      qrTokenSecret: 'qr-test-secret-at-least-16',
      publicBaseUrl: 'http://localhost:8080',
      qrTokenTtlDays: 365,
    });
    app = createApp({ config: { internalServiceToken: internalToken }, verificationService, repository, ledger });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function internal(call, idempotencyKey) {
    const result = call.set('X-Internal-Service-Token', internalToken).set('X-Caller-Service', 'records-service');
    return idempotencyKey ? result.set('Idempotency-Key', idempotencyKey) : result;
  }

  async function register(version = 1, key = `register-key-${version}`) {
    return internal(request(app).post('/registrations'), key).send({
      recordId: 'opaque-record-0001',
      version,
      documentHash: version.toString(16).padStart(64, 'a').slice(-64),
      encryptedCidReference: `encrypted-reference-${version}`,
      approvalTimestamp,
      issuingOrganization: 'Synthetic RHU',
      transactionMetadata: { source: 'records-service' },
    });
  }

  it('reports liveness and clearly marks the development ledger simulated', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data.dependencies.ledger.simulated).toBe(true);
    expect(ready.body.data.dependencies.ledger.warning).toMatch(/not hyperledger fabric/i);
  });

  it('requires internal authentication and rejects prohibited registration fields', async () => {
    expect((await request(app).post('/registrations').send({})).status).toBe(401);
    const bad = await internal(request(app).post('/registrations'), 'register-bad-0001').send({
      recordId: 'opaque-record-0001',
      version: 1,
      documentHash: 'a'.repeat(64),
      approvalTimestamp,
      issuingOrganization: 'Synthetic RHU',
      patientName: 'Must Never Enter Ledger',
    });
    expect(bad.status).toBe(400);
  });

  it('registers idempotently and returns append-only history', async () => {
    const created = await register();
    expect(created.status).toBe(201);
    expect(created.body.data.simulated).toBe(true);
    const duplicate = await register();
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.duplicate).toBe(true);
    const history = await internal(request(app).get('/records/opaque-record-0001/history'));
    expect(history.status).toBe(200);
    expect(history.body.data.items).toHaveLength(1);
    expect(history.body.data.items[0].status).toBe('REGISTERED');
  });

  it('issues a random QR token, persists only its digest, and returns a redacted public response', async () => {
    expect((await register()).status).toBe(201);
    const releaseTimestamp = new Date().toISOString();
    const released = await internal(
      request(app).post('/records/opaque-record-0001/versions/1/release'),
      'release-key-0001',
    ).send({ releaseTimestamp });
    expect(released.status).toBe(200);
    const qrToken = released.body.data.qrToken;
    expect(qrToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await readFile(metadataFile, 'utf8')).not.toContain(qrToken);

    const verified = await request(app).get(`/public/verify/${qrToken}`);
    expect(verified.status).toBe(200);
    expect(verified.body.data.valid).toBe(true);
    expect(verified.body.data.record.issuingOrganization).toBe('Synthetic RHU');
    const serialized = JSON.stringify(verified.body).toLowerCase();
    for (const forbidden of ['patientname', 'address', 'resultvalue', 'documenthash', 'cidreference', qrToken.toLowerCase()]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('revokes the proof and makes its public token invalid', async () => {
    await register();
    const released = await internal(request(app).post('/records/opaque-record-0001/versions/1/release'), 'release-key-0001')
      .send({ releaseTimestamp: new Date().toISOString() });
    const qrToken = released.body.data.qrToken;
    const revoked = await internal(request(app).post('/records/opaque-record-0001/versions/1/revoke'), 'revoke-key-0001')
      .send({ reasonCode: 'CORRECTED', revokedAt: new Date().toISOString() });
    expect(revoked.body.data.status).toBe('REVOKED');
    const publicResult = await request(app).get(`/public/verify/${qrToken}`);
    expect(publicResult.body.data).toEqual({ valid: false, status: 'REVOKED' });
    const history = await internal(request(app).get('/records/opaque-record-0001/history'));
    expect(history.body.data.items.map((item) => item.status)).toEqual(['REGISTERED', 'RELEASED', 'REVOKED']);
  });

  it('rejects registration version gaps', async () => {
    const response = await register(2);
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/first.*version 1/i);
  });
});
