import { Contract } from 'fabric-contract-api';
import { LabRecordContractCore } from './labrecord-contract-core.js';

/** Fabric-facing wrapper around the independently testable domain contract. */
export class LabRecordContract extends Contract {
  constructor() {
    super('LabRecordContract');
    this.core = new LabRecordContractCore();
  }

  RegisterRecord(ctx, payload) { return this.core.RegisterRecord(ctx, payload); }
  RegisterRecordVersion(ctx, payload) { return this.core.RegisterRecordVersion(ctx, payload); }
  GetRecord(ctx, recordId, version) { return this.core.GetRecord(ctx, recordId, version); }
  GetRecordHistory(ctx, recordId) { return this.core.GetRecordHistory(ctx, recordId); }
  VerifyRecord(ctx, recordId, version, hash) { return this.core.VerifyRecord(ctx, recordId, version, hash); }
  ReleaseRecord(ctx, recordId, version, timestamp) { return this.core.ReleaseRecord(ctx, recordId, version, timestamp); }
  RevokeRecord(ctx, recordId, version, reason, timestamp) { return this.core.RevokeRecord(ctx, recordId, version, reason, timestamp); }
}

export const contracts = [LabRecordContract];
