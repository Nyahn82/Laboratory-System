import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).optional(),
  STORAGE_PORT: z.coerce.number().int().positive().max(65535).optional(),
  DB_DRIVER: z.enum(['file', 'mysql']).default('file'),
  OBJECT_STORE_DRIVER: z.enum(['filesystem', 'ipfs']).default('filesystem'),
  DATA_ROOT: z.string().default('./data'),
  INTERNAL_SERVICE_TOKEN: z.string().min(16),
  STORAGE_MASTER_KEY_BASE64: z.string().min(1),
  STORAGE_MASTER_KEY_ID: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).default('local-master-v1'),
  MYSQL_HOST: z.string().default('127.0.0.1'),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().default('storage_service'),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_DATABASE: z.string().default('storage_db'),
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
  IPFS_API_URL: z.string().url().default('http://127.0.0.1:5001'),
  MAX_JSON_BYTES: z.coerce.number().int().positive().default(5_000_000),
});

export function loadConfig(overrides = {}) {
  const values = schema.parse({ ...process.env, ...overrides });
  const masterKey = Buffer.from(values.STORAGE_MASTER_KEY_BASE64, 'base64');
  if (masterKey.length !== 32) {
    throw new Error('STORAGE_MASTER_KEY_BASE64 must decode to exactly 32 bytes.');
  }
  const dataRoot = path.resolve(values.DATA_ROOT);
  return {
    nodeEnv: values.NODE_ENV,
    port: values.STORAGE_PORT ?? values.PORT ?? 3003,
    dbDriver: values.DB_DRIVER,
    objectStoreDriver: values.OBJECT_STORE_DRIVER,
    dataRoot,
    metadataFile: path.join(dataRoot, 'storage-metadata.json'),
    objectDirectory: path.join(dataRoot, 'encrypted-objects'),
    internalServiceToken: values.INTERNAL_SERVICE_TOKEN,
    masterKey,
    masterKeyId: values.STORAGE_MASTER_KEY_ID,
    maxJsonBytes: values.MAX_JSON_BYTES,
    ipfsApiUrl: values.IPFS_API_URL.replace(/\/$/, ''),
    mysql: {
      host: values.MYSQL_HOST,
      port: values.MYSQL_PORT,
      user: values.MYSQL_USER,
      password: values.MYSQL_PASSWORD,
      database: values.MYSQL_DATABASE,
      connectionLimit: values.MYSQL_CONNECTION_LIMIT,
    },
  };
}
