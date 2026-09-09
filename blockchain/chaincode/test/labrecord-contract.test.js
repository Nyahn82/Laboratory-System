import { describe, expect, it } from 'vitest';
import { LabRecordContractCore, ledgerPrivacy } from '../src/labrecord-contract-core.js';

class MemoryStub {
  constructor() {
    this.state = new Map();
    this.history = new Map();
    this.counter = 1;
    this.time = Date.parse('2026-08-29T00:00:00.000Z');
  }

  createCompositeKey(namespace, attributes) { return `${namespace}\u0000${attributes.join('\u0000')}\u0000`; }
  async getState(key) { return this.state.get(key) || Buffer.alloc(0); }
  getTxID() { return `tx-${this.counter}`; }
  getTxTimestamp() {
    return { seconds: { toString: () => String(Math.floor(this.time / 1000)) }, nanos: (this.time % 1000) * 1_000_000 };
  }

  async putState(key, bytes) {
    const value = Buffer.from(bytes);
    this.state.set(key, value);
    const entries = this.history.get(key) || [];
    entries.push({ txId: this.getTxID(), timestamp: this.getTxTimestamp(), isDelete: false, value });
    this.history.set(key, entries);
  }

  async getHistoryForKey(key) {
    const entries = [...(this.history.get(key) || [])];
    let index = 0;
    return {
      next: async () => index < entries.length ? { value: entries[index++], done: false } : { done: true },
      close: async () => {},
    };
  }

  nextTransaction() { this.counter += 1; this.time += 1000; }
}

function context(mspId = 'RHULabMSP') {
  return { stub: new MemoryStub(), clientIdentity: { getMSPID: () => mspId } };
}

function proof(overrides = {}) {
  return {
    recordId: 'opaque-record-0001',
    version: 1,
    documentHash: 'a'.repeat(64),
    encryptedCidReference: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3fteivg23ai',
    approvalTimestamp: '2026-08-28T23:59:00.000Z',
    issuingOrganization: 'RHU Laboratory Department',
    transactionMetadata: { correlationId: 'request-0001', source: 'records-service' },
    ...overrides,
  };
}

describe('LabRecordContract privacy and lifecycle', () => {
  it('stores only allow-listed opaque proof fields', async () => {
    const ctx = context();
    const contract = new LabRecordContractCore();
    const registered = await contract.RegisterRecord(ctx, JSON.stringify(proof()));
    expect(registered.status).toBe('REGISTERED');
    expect((await contract.VerifyRecord(ctx, registered.recordId, '1', registered.documentHash)).valid).toBe(true);
    const serialized = [...ctx.stub.state.values()].map((value) => value.toString('utf8')).join(' ');
    expect(serialized).not.toMatch(/patient|address|resultValue|medicalHistory|password|encryptionKey/i);
    expect(ledgerPrivacy.allowedRegistrationFields).not.toContain('patientName');
  });

  it('rejects sensitive or unknown fields before writing state', async () => {
    const ctx = context();
    const contract = new LabRecordContractCore();
    await expect(contract.RegisterRecord(ctx, JSON.stringify({ ...proof(), patientName: 'Synthetic Patient' })))
      .rejects.toThrow(/PRIVACY_FIELD_REJECTED/);
    await expect(contract.RegisterRecord(ctx, JSON.stringify({ ...proof(), transactionMetadata: { source: 'records-service', resultValue: '15' } })))
      .rejects.toThrow(/PRIVACY_FIELD_REJECTED/);
    expect(ctx.stub.state.size).toBe(0);
  });

  it('enforces sequential immutable versions', async () => {
    const ctx = context();
    const contract = new LabRecordContractCore();
    await contract.RegisterRecord(ctx, JSON.stringify(proof()));
    ctx.stub.nextTransaction();
    await expect(contract.RegisterRecordVersion(ctx, JSON.stringify(proof({ version: 3, documentHash: 'c'.repeat(64) }))))
      .rejects.toThrow(/VERSION_SEQUENCE_INVALID/);
    await contract.RegisterRecordVersion(ctx, JSON.stringify(proof({ version: 2, documentHash: 'b'.repeat(64) })));
    ctx.stub.nextTransaction();
    await expect(contract.RegisterRecordVersion(ctx, JSON.stringify(proof({ version: 2, documentHash: 'c'.repeat(64) }))))
      .rejects.toThrow(/VERSION_CONFLICT/);
  });

  it('records release and revocation history and invalidates revoked proofs', async () => {
    const ctx = context();
    const contract = new LabRecordContractCore();
    await contract.RegisterRecord(ctx, JSON.stringify(proof()));
    ctx.stub.nextTransaction();
    await contract.ReleaseRecord(ctx, proof().recordId, '1', '2026-08-29T00:00:01.000Z');
    ctx.stub.nextTransaction();
    await contract.RevokeRecord(ctx, proof().recordId, '1', 'CORRECTED', '2026-08-29T00:00:02.000Z');
    expect((await contract.VerifyRecord(ctx, proof().recordId, '1', proof().documentHash)).valid).toBe(false);
    expect((await contract.GetRecordHistory(ctx, proof().recordId)).items.map((item) => item.status))
      .toEqual(['REGISTERED', 'RELEASED', 'REVOKED']);
  });

  it('allows the verifier organization to query but not mutate', async () => {
    const writer = context();
    const contract = new LabRecordContractCore();
    await contract.RegisterRecord(writer, JSON.stringify(proof()));
    const verifier = { stub: writer.stub, clientIdentity: { getMSPID: () => 'VerifierMSP' } };
    expect((await contract.GetRecord(verifier, proof().recordId, '1')).documentHash).toBe(proof().documentHash);
    await expect(contract.ReleaseRecord(verifier, proof().recordId, '1', '2026-08-29T00:00:01.000Z'))
      .rejects.toThrow(/ACCESS_DENIED/);
  });
});
