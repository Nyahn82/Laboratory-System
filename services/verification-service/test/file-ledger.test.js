import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileLedger } from '../src/adapters/file-ledger.js';

describe('development file ledger', () => {
  let directory;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it('preserves registration, release, and revocation history', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'labchain-ledger-'));
    const ledger = new FileLedger(path.join(directory, 'ledger.json'));
    await ledger.init();
    const payload = {
      recordId: 'opaque-record-0001',
      version: 1,
      documentHash: 'a'.repeat(64),
      approvalTimestamp: new Date().toISOString(),
      issuingOrganization: 'Synthetic RHU',
    };
    await ledger.registerRecord(payload);
    expect((await ledger.verifyRecord(payload.recordId, 1, payload.documentHash)).valid).toBe(true);
    await ledger.releaseRecord(payload.recordId, 1, new Date().toISOString());
    await ledger.revokeRecord(payload.recordId, 1, 'CORRECTED', new Date().toISOString());
    expect((await ledger.verifyRecord(payload.recordId, 1, payload.documentHash)).valid).toBe(false);
    expect(await ledger.getRecordHistory(payload.recordId)).toHaveLength(3);
  });
});
