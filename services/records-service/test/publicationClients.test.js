import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicationClients } from '../src/clients/publicationClients.js';

const config = {
  storageServiceUrl: 'http://storage.test', verificationServiceUrl: 'http://verification.test',
  internalServiceToken: 'internal-token-value', clientTimeoutMs: 1000,
};

describe('publication clients', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the internal service contracts and stable idempotency inputs', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      if (url.includes('/packages')) return { ok: true, json: async () => ({ data: { envelopeHash: 'a'.repeat(64), objectReference: 'ipfs://ciphertext', protectedObjectReference: 'protected-object-reference-0001' } }) };
      if (url.endsWith('/registrations')) return { ok: true, json: async () => ({ data: { transactionId: 'register-tx' } }) };
      return { ok: true, json: async () => ({ data: { transactionId: 'release-tx', qrToken: 'A'.repeat(43) } }) };
    }));
    const clients = createPublicationClients(config);
    const snapshot = { schema: 'rhu.lab-result.v1', patientSnapshot: { patientCode: 'private' } };
    await clients.storePackage({ snapshot, opaqueRecordId: 'opaque-record-1', version: 1, idempotencyKey: 'storage-event-1' });
    await clients.registerLedger({ opaqueRecordId: 'opaque-record-1', version: 1, ciphertextHash: 'b'.repeat(64), protectedObjectReference: 'ipfs://ciphertext', approvedAt: '2026-01-01T00:00:00.000Z', idempotencyKey: 'ledger-event-1' });
    await clients.releaseLedger({ opaqueRecordId: 'opaque-record-1', version: 1, releaseTimestamp: '2026-01-02T00:00:00.000Z', idempotencyKey: 'release-event-1' });

    expect(calls[0]).toMatchObject({ url: 'http://storage.test/packages', body: { recordId: 'opaque-record-1', version: 1, record: snapshot } });
    expect(calls[1]).toMatchObject({ url: 'http://verification.test/registrations', body: { recordId: 'opaque-record-1', version: 1, documentHash: 'b'.repeat(64), encryptedCidReference: 'ipfs://ciphertext' } });
    expect(calls[2]).toMatchObject({ url: 'http://verification.test/records/opaque-record-1/versions/1/release', body: { releaseTimestamp: '2026-01-02T00:00:00.000Z' } });
    expect(calls.every((call) => call.options.headers['x-caller-service'] === 'records-service')).toBe(true);
  });

  it('converts dependency failures into a safe publication error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ message: 'dependency unavailable' }) })));
    const clients = createPublicationClients(config);
    await expect(clients.storePackage({ snapshot: {}, opaqueRecordId: 'record-123', version: 1, idempotencyKey: 'storage-event-2' }))
      .rejects.toMatchObject({ status: 502, code: 'PUBLICATION_DEPENDENCY_FAILED' });
  });
});
