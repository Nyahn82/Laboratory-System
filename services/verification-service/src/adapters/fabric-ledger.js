import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { VerificationError } from '../errors.js';

function decode(result) {
  const text = Buffer.from(result).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function fabricError(error, fallbackMessage, fallbackCode) {
  if (error instanceof VerificationError) return error;
  const message = `${error?.message || ''} ${error?.details || ''}`;
  const mappings = [
    [/RECORD_NOT_FOUND|LEDGER_RECORD_NOT_FOUND|does not exist|not found/i, 404, 'Ledger record version was not found.', 'LEDGER_RECORD_NOT_FOUND'],
    [/VALIDATION_FAILED|PRIVACY_FIELD_REJECTED|INVALID_(?:RECORD|VERSION|HASH|TIMESTAMP)/i, 400, 'Fabric rejected invalid verification data.', 'FABRIC_VALIDATION_FAILED'],
    [/VERSION_CONFLICT|VERSION_SEQUENCE|IMMUTABLE|ALREADY_RELEASED|ALREADY_REVOKED|RECORD_REVOKED/i, 409, 'Fabric rejected a conflicting record transition.', 'FABRIC_STATE_CONFLICT'],
  ];
  for (const [pattern, status, publicMessage, code] of mappings) {
    if (pattern.test(message)) return new VerificationError(status, publicMessage, code);
  }
  return new VerificationError(503, fallbackMessage, fallbackCode);
}

export class FabricLedger {
  constructor(config) {
    this.config = config;
    this.provider = 'hyperledger-fabric';
    this.simulated = false;
    this.gateway = null;
    this.client = null;
    this.contract = null;
  }

  async init() {
    if (this.contract) return;
    let gatewayModule;
    let grpc;
    try {
      gatewayModule = await import('@hyperledger/fabric-gateway');
      grpc = await import('@grpc/grpc-js');
    } catch {
      throw new VerificationError(503, 'Fabric Gateway dependencies are not installed.', 'FABRIC_DEPENDENCY_MISSING');
    }
    const [tlsRootCert, identityCredentials, privateKeyPem] = await Promise.all([
      readFile(this.config.tlsCertPath),
      readFile(this.config.identityCertPath),
      readFile(this.config.identityKeyPath),
    ]);
    const credentials = grpc.credentials.createSsl(tlsRootCert);
    this.client = new grpc.Client(this.config.peerEndpoint, credentials, {
      'grpc.ssl_target_name_override': this.config.peerHostAlias,
      'grpc.default_authority': this.config.peerHostAlias,
    });
    const signer = gatewayModule.signers.newPrivateKeySigner(createPrivateKey(privateKeyPem));
    this.gateway = gatewayModule.connect({
      client: this.client,
      identity: { mspId: this.config.mspId, credentials: identityCredentials },
      signer,
      evaluateOptions: () => ({ deadline: Date.now() + 5_000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
      submitOptions: () => ({ deadline: Date.now() + 5_000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
    });
    this.contract = this.gateway.getNetwork(this.config.channel).getContract(this.config.chaincode);
  }

  async #submit(name, ...args) {
    await this.init();
    try {
      const proposal = this.contract.newProposal(name, { arguments: args.map(String) });
      const transaction = await proposal.endorse();
      const result = transaction.getResult();
      const submitted = await transaction.submit();
      const status = await submitted.getStatus();
      if (!status.successful) throw new Error(`Fabric commit status ${status.code}`);
      return { transactionId: transaction.getTransactionId(), record: decode(result), duplicate: false, simulated: false };
    } catch (error) {
      throw fabricError(error, 'Fabric transaction could not be committed.', 'FABRIC_SUBMIT_FAILED');
    }
  }

  async #evaluate(name, ...args) {
    await this.init();
    try {
      return decode(await this.contract.evaluateTransaction(name, ...args.map(String)));
    } catch (error) {
      if (/does not exist|not found/i.test(error.message)) return null;
      throw fabricError(error, 'Fabric query failed.', 'FABRIC_QUERY_FAILED');
    }
  }

  registerRecord(payload) { return this.#submit('RegisterRecord', JSON.stringify(payload)); }
  registerRecordVersion(payload) { return this.#submit('RegisterRecordVersion', JSON.stringify(payload)); }
  releaseRecord(recordId, version, timestamp) { return this.#submit('ReleaseRecord', recordId, version, timestamp); }
  revokeRecord(recordId, version, reasonCode, timestamp) { return this.#submit('RevokeRecord', recordId, version, reasonCode, timestamp); }
  getRecord(recordId, version) { return this.#evaluate('GetRecord', recordId, version); }
  getRecordHistory(recordId) { return this.#evaluate('GetRecordHistory', recordId); }
  verifyRecord(recordId, version, hash) { return this.#evaluate('VerifyRecord', recordId, version, hash); }

  async health() {
    try {
      await this.init();
      await this.contract.evaluateTransaction('GetRecordHistory', 'health-check-record');
      return { ok: true, provider: this.provider, simulated: false, channel: this.config.channel, chaincode: this.config.chaincode };
    } catch {
      return { ok: false, provider: this.provider, simulated: false, channel: this.config.channel, chaincode: this.config.chaincode };
    }
  }

  async close() {
    this.gateway?.close();
    this.client?.close();
  }
}
