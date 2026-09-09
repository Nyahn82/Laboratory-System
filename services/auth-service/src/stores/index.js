import { FileAuthStore } from './file-auth-store.js';
import { MemoryAuthStore } from './memory-auth-store.js';
import { MySqlAuthStore } from './mysql-auth-store.js';

export function createAuthStore(config) {
  const driver = config.dbDriver ?? config.storeKind;
  if (driver === 'mysql') return new MySqlAuthStore(config.database);
  if (driver === 'memory') return new MemoryAuthStore();
  if (driver === 'file') return new FileAuthStore({ filename: config.authDataFile });
  throw new Error(`Unsupported authentication database driver: ${driver}`);
}

export { FileAuthStore, MemoryAuthStore, MySqlAuthStore };
