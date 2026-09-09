import { browserOrigins } from './browserOrigins.js';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).optional(),
  RECORDS_PORT: z.coerce.number().int().positive().max(65535).default(3002),
  DB_DRIVER: z.enum(['file', 'mysql']).default('file'),
  DATA_ROOT: z.string().min(1).default('../../data'),
  RECORDS_DATA_FILE: z.string().optional(),
  AUTH_JWT_SECRET: z.string().min(16),
  INTERNAL_SERVICE_TOKEN: z.string().min(16),
  STORAGE_SERVICE_URL: z.string().url().default('http://127.0.0.1:3003'),
  VERIFICATION_SERVICE_URL: z.string().url().default('http://127.0.0.1:3004'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  CLIENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),
  MYSQL_HOST: z.string().min(1).default('127.0.0.1'),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1).default('labchain'),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_DATABASE: z.string().min(1).default('records_db'),
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
});

export function loadConfig(overrides = {}) {
  const values = schema.parse({
    ...process.env,
    ...(overrides.port !== undefined ? { PORT: overrides.port } : {}),
    ...(overrides.authJwtSecret !== undefined ? { AUTH_JWT_SECRET: overrides.authJwtSecret } : {}),
    ...(overrides.internalServiceToken !== undefined ? { INTERNAL_SERVICE_TOKEN: overrides.internalServiceToken } : {}),
  });
  const dataRoot = path.resolve(values.DATA_ROOT);
  const config = {
    nodeEnv: values.NODE_ENV,
    // Docker Compose and the native launcher use PORT. RECORDS_PORT remains a
    // convenient service-specific override when the service is run directly.
    port: values.PORT ?? values.RECORDS_PORT,
    dbDriver: values.DB_DRIVER,
    dataRoot,
    recordsDataFile: values.RECORDS_DATA_FILE
      ? path.resolve(values.RECORDS_DATA_FILE)
      : path.join(dataRoot, 'records', 'records.json'),
    authJwtSecret: values.AUTH_JWT_SECRET,
    internalServiceToken: values.INTERNAL_SERVICE_TOKEN,
    storageServiceUrl: values.STORAGE_SERVICE_URL.replace(/\/$/, ''),
    verificationServiceUrl: values.VERIFICATION_SERVICE_URL.replace(/\/$/, ''),
    publicBaseUrl: values.PUBLIC_BASE_URL.replace(/\/$/, ''),
    clientTimeoutMs: values.CLIENT_TIMEOUT_MS,
    corsOrigins: browserOrigins(values.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean), values.NODE_ENV),
    database: {
      host: values.MYSQL_HOST,
      port: values.MYSQL_PORT,
      user: values.MYSQL_USER,
      password: values.MYSQL_PASSWORD,
      database: values.MYSQL_DATABASE,
      connectionLimit: values.MYSQL_CONNECTION_LIMIT,
    },
    ...overrides,
  };

  if (config.nodeEnv === 'production') {
    if (config.authJwtSecret.length < 32) throw new Error('AUTH_JWT_SECRET must be at least 32 characters in production.');
    if (config.internalServiceToken.length < 32) throw new Error('INTERNAL_SERVICE_TOKEN must be at least 32 characters in production.');
  }
  return config;
}
