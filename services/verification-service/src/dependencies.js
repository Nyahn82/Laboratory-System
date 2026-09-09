import { FileLedger } from './adapters/file-ledger.js';
import { FabricLedger } from './adapters/fabric-ledger.js';
import { FileVerificationRepository } from './repositories/file-verification-repository.js';
import { MysqlVerificationRepository } from './repositories/mysql-verification-repository.js';
import { VerificationService } from './services/verification-service.js';

export async function createDependencies(config) {
  const repository = config.dbDriver === 'mysql'
    ? new MysqlVerificationRepository(config.mysql)
    : new FileVerificationRepository(config.metadataFile);
  const ledger = config.ledgerDriver === 'fabric'
    ? new FabricLedger(config.fabric)
    : new FileLedger(config.ledgerFile);
  await Promise.all([repository.init(), ledger.init()]);
  const verificationService = new VerificationService({
    repository,
    ledger,
    qrTokenSecret: config.qrTokenSecret,
    publicBaseUrl: config.publicBaseUrl,
    qrTokenTtlDays: config.qrTokenTtlDays,
  });
  return { repository, ledger, verificationService };
}
