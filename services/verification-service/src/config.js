import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).optional(),
  VERIFICATION_PORT: z.coerce.number().int().positive().max(65535).optional(),
  DB_DRIVER: z.enum(['file', 'mysql']).default('file'),
  LEDGER_DRIVER: z.enum(['file', 'fabric']).default('file'),
  DATA_ROOT: z.string().default('./data'),
  INTERNAL_SERVICE_TOKEN: z.string().min(16),
  QR_TOKEN_SECRET: z.string().min(16),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  AUTH_SERVICE_URL: z.string().url().default('http://127.0.0.1:3001'),
  FABRIC_RHU_OPERATIONS_URL: z.string().url().default('http://peer0.rhu.local:9443/healthz'),
  FABRIC_VERIFIER_OPERATIONS_URL: z.string().url().default('http://peer0.verifier.local:9443/healthz'),
  FABRIC_ORDERER_OPERATIONS_URL: z.string().url().default('http://orderer.local:9443/healthz'),
  QR_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(3650).default(365),
  MYSQL_HOST: z.string().default('127.0.0.1'),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().default('verification_service'),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_DATABASE: z.string().default('verification_db'),
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
  FABRIC_CHANNEL: z.string().default('labrecords'),
  FABRIC_CHAINCODE: z.string().default('labrecord-contract'),
  FABRIC_MSP_ID: z.string().default('RHULabMSP'),
  FABRIC_GATEWAY_PEER: z.string().default('peer0.rhu.local:7051'),
  FABRIC_PEER_HOST_ALIAS: z.string().default('peer0.rhu.local'),
  FABRIC_TLS_CERT_PATH: z.string().default('/fabric/peer-tls/ca.crt'),
  FABRIC_IDENTITY_CERT_PATH: z.string().default('/fabric/user/signcert.pem'),
  FABRIC_IDENTITY_KEY_PATH: z.string().default('/fabric/user/keystore/key.pem'),
});

export function loadConfig(overrides = {}) {
  const values = schema.parse({ ...process.env, ...overrides });
  const dataRoot = path.resolve(values.DATA_ROOT);
  return {
    nodeEnv: values.NODE_ENV,
    port: values.VERIFICATION_PORT ?? values.PORT ?? 3004,
    dbDriver: values.DB_DRIVER,
    ledgerDriver: values.LEDGER_DRIVER,
    dataRoot,
    metadataFile: path.join(dataRoot, 'verification-metadata.json'),
    ledgerFile: path.join(dataRoot, 'development-ledger.json'),
    internalServiceToken: values.INTERNAL_SERVICE_TOKEN,
    qrTokenSecret: values.QR_TOKEN_SECRET,
    publicBaseUrl: values.PUBLIC_BASE_URL.replace(/\/$/, ''),
    authServiceUrl: values.AUTH_SERVICE_URL.replace(/\/$/, ''),
    qrTokenTtlDays: values.QR_TOKEN_TTL_DAYS,
    mysql: {
      host: values.MYSQL_HOST,
      port: values.MYSQL_PORT,
      user: values.MYSQL_USER,
      password: values.MYSQL_PASSWORD,
      database: values.MYSQL_DATABASE,
      connectionLimit: values.MYSQL_CONNECTION_LIMIT,
    },
    fabric: {
      rhuOperationsUrl: values.FABRIC_RHU_OPERATIONS_URL,
      verifierOperationsUrl: values.FABRIC_VERIFIER_OPERATIONS_URL,
      ordererOperationsUrl: values.FABRIC_ORDERER_OPERATIONS_URL,
      channel: values.FABRIC_CHANNEL,
      chaincode: values.FABRIC_CHAINCODE,
      mspId: values.FABRIC_MSP_ID,
      peerEndpoint: values.FABRIC_GATEWAY_PEER,
      peerHostAlias: values.FABRIC_PEER_HOST_ALIAS,
      tlsCertPath: values.FABRIC_TLS_CERT_PATH,
      identityCertPath: values.FABRIC_IDENTITY_CERT_PATH,
      identityKeyPath: values.FABRIC_IDENTITY_KEY_PATH,
    },
  };
}
