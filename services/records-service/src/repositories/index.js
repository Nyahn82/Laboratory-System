import { FileRecordsRepository } from './fileRecordsRepository.js';
import { MysqlRecordsRepository } from './mysqlRecordsRepository.js';

export function createRecordsRepository(config) {
  if (config.dbDriver === 'mysql') return new MysqlRecordsRepository(config.database);
  return new FileRecordsRepository({ filePath: config.recordsDataFile });
}
