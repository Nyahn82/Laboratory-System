import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}, z.boolean());

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  DB_DRIVER: z.enum(['file', 'mysql']).default('file'),
  DATA_ROOT: z.string().min(1).default('../../data'),
  AUTH_DATA_FILE: z.string().min(1).optional(),
  AUTH_JWT_SECRET: z.string().min(1).optional(),
  JWT_ACCESS_SECRET: z.string().min(1).optional(),
  JWT_ISSUER: z.string().min(1).default('lab-record-auth'),
  JWT_AUDIENCE: z.string().min(1).default('lab-record-platform'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().positive().optional(),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  COOKIE_SECURE: booleanFromEnvironment.default(false),
  TRUST_PROXY: booleanFromEnvironment.default(false),
  RATE_LIMIT_ENABLED: booleanFromEnvironment.default(true),
  EXPOSE_DEV_RESET_TOKEN: booleanFromEnvironment.optional(),
  EXPOSE_RESET_TOKEN: booleanFromEnvironment.optional(),
  MYSQL_HOST: z.string().min(1).optional(),
  MYSQL_PORT: z.coerce.number().int().positive().optional(),
  MYSQL_DATABASE: z.string().min(1).optional(),
  MYSQL_USER: z.string().min(1).optional(),
  MYSQL_PASSWORD: z.string().optional(),
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().positive().optional(),
  DB_HOST: z.string().min(1).optional(),
  DB_PORT: z.coerce.number().int().positive().optional(),
  DB_NAME: z.string().min(1).optional(),
  DB_USER: z.string().min(1).optional(),
  DB_PASSWORD: z.string().optional(),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().optional(),
});

export function loadConfig(overrides = {}) {
  const values = environmentSchema.parse(process.env);
  const dataRoot = path.resolve(values.DATA_ROOT);
  const jwtAccessSecret = values.AUTH_JWT_SECRET
    ?? values.JWT_ACCESS_SECRET
    ?? 'development-only-auth-secret-change-before-production';
  const config = {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    dbDriver: values.DB_DRIVER,
    storeKind: values.DB_DRIVER,
    dataRoot,
    authDataFile: values.AUTH_DATA_FILE
      ? path.resolve(values.AUTH_DATA_FILE)
      : path.join(dataRoot, 'auth', 'auth.json'),
    jwtAccessSecret,
    jwtIssuer: values.JWT_ISSUER,
    jwtAudience: values.JWT_AUDIENCE,
    jwtAccessTtlSeconds: values.ACCESS_TOKEN_TTL_SECONDS ?? values.JWT_ACCESS_TTL_SECONDS ?? 900,
    refreshTokenTtlSeconds: values.REFRESH_TOKEN_TTL_SECONDS
      ?? Math.round((values.REFRESH_TOKEN_TTL_DAYS ?? 7) * 86_400),
    passwordResetTtlSeconds: values.PASSWORD_RESET_TTL_SECONDS,
    bcryptRounds: values.BCRYPT_ROUNDS,
    cookieName: 'refresh_token',
    cookieSecure: values.COOKIE_SECURE,
    trustProxy: values.TRUST_PROXY,
    rateLimitEnabled: values.RATE_LIMIT_ENABLED,
    exposeResetToken: values.EXPOSE_DEV_RESET_TOKEN ?? values.EXPOSE_RESET_TOKEN ?? false,
    database: {
      host: values.MYSQL_HOST ?? values.DB_HOST ?? '127.0.0.1',
      port: values.MYSQL_PORT ?? values.DB_PORT ?? 3306,
      database: values.MYSQL_DATABASE ?? values.DB_NAME ?? 'auth_db',
      user: values.MYSQL_USER ?? values.DB_USER ?? 'labchain_auth',
      password: values.MYSQL_PASSWORD ?? values.DB_PASSWORD ?? '',
      connectionLimit: values.MYSQL_CONNECTION_LIMIT ?? values.DB_CONNECTION_LIMIT ?? 10,
    },
    ...overrides,
  };

  if (config.nodeEnv === 'production' && config.jwtAccessSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters in production');
  }

  return config;
}
