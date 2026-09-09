import { FileObjectStore } from './adapters/file-object-store.js';
import { IpfsObjectStore } from './adapters/ipfs-object-store.js';
import { FileStorageRepository } from './repositories/file-storage-repository.js';
import { MysqlStorageRepository } from './repositories/mysql-storage-repository.js';
import { PackageService } from './services/package-service.js';

export async function createDependencies(config) {
  const repository = config.dbDriver === 'mysql'
    ? new MysqlStorageRepository(config.mysql)
    : new FileStorageRepository(config.metadataFile);
  const objectStore = config.objectStoreDriver === 'ipfs'
    ? new IpfsObjectStore(config.ipfsApiUrl)
    : new FileObjectStore(config.objectDirectory);
  await Promise.all([repository.init(), objectStore.init()]);
  const packageService = new PackageService({
    repository,
    objectStore,
    masterKey: config.masterKey,
    masterKeyId: config.masterKeyId,
    maxJsonBytes: config.maxJsonBytes,
  });
  return { repository, objectStore, packageService };
}
