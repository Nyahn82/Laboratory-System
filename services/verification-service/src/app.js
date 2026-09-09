import express from 'express';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';
import {
  ApiError,
  asyncRoute,
  errorHandler,
  notFound,
  requestContext,
  requireIdempotencyKey,
  sendSuccess,
  standardSecurity,
} from '@rhu-labchain/service-kit';
import { requireInternalToken } from './middleware/internal-auth.js';
import { openapi } from './openapi.js';
import { logger } from './logger.js';
import { nodeStatus, requireAdministrator } from './services/node-status.js';

const recordIdSchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const versionSchema = z.coerce.number().int().positive();
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });
const registerSchema = z.object({
  recordId: recordIdSchema,
  version: z.number().int().positive(),
  documentHash: hashSchema,
  encryptedCidReference: z.string().min(8).max(512).optional(),
  approvalTimestamp: timestampSchema,
  issuingOrganization: z.string().min(2).max(120),
  transactionMetadata: z.object({
    correlationId: z.string().max(128).optional(),
    source: z.string().max(80).optional(),
  }).strict().optional(),
}).strict();
const legacyRegisterSchema = z.object({
  opaqueRecordId: recordIdSchema,
  version: z.number().int().positive(),
  ciphertextHash: hashSchema,
  protectedObjectReference: z.string().min(8).max(512).optional(),
  approvedAt: timestampSchema,
  issuingOrganization: z.string().min(2).max(120),
  transactionMetadata: z.object({
    correlationId: z.string().max(128).optional(),
    source: z.string().max(80).optional(),
  }).strict().optional(),
}).strict();
const releaseSchema = z.object({ releaseTimestamp: timestampSchema }).strict();
const legacyReleaseSchema = z.object({ releaseTimestamp: timestampSchema.optional() }).strict();
const revokeSchema = z.object({
  reasonCode: z.enum(['CORRECTED', 'ISSUED_IN_ERROR', 'SECURITY', 'OTHER']),
  revokedAt: timestampSchema,
}).strict();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, 'Request validation failed.', result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })), 'VALIDATION_FAILED');
  }
  return result.data;
}

export function createApp({ config, verificationService, repository, ledger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(standardSecurity({ isPublic: false }));
  app.use(requestContext);
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    res.on('finish', () => logger.info('http_request', { requestId: req.requestId, status: res.statusCode }));
    next();
  });

  app.get('/health', (_req, res) => sendSuccess(res, 200, 'Verification service is alive.', {
    service: 'verification-service',
    status: 'healthy',
    adapter: ledger.provider,
    ledgerDriver: config.ledgerDriver || ledger.provider,
    dbDriver: config.dbDriver || repository.provider,
    simulated: Boolean(ledger.simulated || repository.simulated),
  }));
  app.get('/ready', asyncRoute(async (_req, res) => {
    const [database, ledgerStatus] = await Promise.all([repository.health(), ledger.health()]);
    const ready = database.ok && ledgerStatus.ok;
    return sendSuccess(res, ready ? 200 : 503, ready ? 'Verification service is ready.' : 'Verification service dependencies are unavailable.', {
      service: 'verification-service',
      status: ready ? 'ready' : 'not-ready',
      adapter: ledgerStatus.provider,
      ledgerDriver: config.ledgerDriver || ledgerStatus.provider,
      dbDriver: config.dbDriver || database.provider,
      simulated: Boolean(ledgerStatus.simulated || database.simulated),
      dependencies: { metadata: database, ledger: ledgerStatus },
    });
  }));
  app.get('/openapi.json', (_req, res) => res.json(openapi));
  app.get('/nodes', asyncRoute(async (req, res) => {
    await requireAdministrator(req.get('authorization'), config);
    return sendSuccess(res, 200, 'Blockchain node checks completed.', await nodeStatus(config, ledger));
  }));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Verification Service API' }));

  const publicLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message: 'Too many verification requests. Try again shortly.', data: {}, errors: [] },
  });
  app.get(['/public/verify/:token', '/public/:token'], publicLimiter, asyncRoute(async (req, res) => {
    const token = parse(tokenSchema, req.params.token);
    const data = await verificationService.publicVerify(token, { requestId: req.requestId, source: 'public-http' });
    return sendSuccess(res, 200, data.valid ? 'Record verification succeeded.' : 'Record could not be verified.', data);
  }));

  const internal = express.Router();
  internal.use(requireInternalToken(config.internalServiceToken));
  const register = (schema, normalize = (value) => value) => asyncRoute(async (req, res) => {
    const body = normalize(parse(schema, req.body));
    const data = await verificationService.register(body, requireIdempotencyKey(req));
    return sendSuccess(res, data.duplicate ? 200 : 201, data.duplicate ? 'Ledger registration already exists.' : 'Ledger registration committed.', data);
  });
  internal.post('/registrations', register(registerSchema));
  internal.post('/internal/v1/registrations', register(legacyRegisterSchema, (body) => ({
    recordId: body.opaqueRecordId,
    version: body.version,
    documentHash: body.ciphertextHash,
    encryptedCidReference: body.protectedObjectReference,
    approvalTimestamp: body.approvedAt,
    issuingOrganization: body.issuingOrganization,
    transactionMetadata: body.transactionMetadata,
  })));
  internal.get('/records/:recordId/versions/:version', asyncRoute(async (req, res) => {
    const recordId = parse(recordIdSchema, req.params.recordId);
    const version = parse(versionSchema, req.params.version);
    const registration = await repository.getRegistration(recordId, version);
    if (!registration) throw new ApiError(404, 'Ledger registration was not found.', [], 'LEDGER_RECORD_NOT_FOUND');
    return sendSuccess(res, 200, 'Ledger registration retrieved.', registration);
  }));
  internal.post('/records/:recordId/versions/:version/release', asyncRoute(async (req, res) => {
    const recordId = parse(recordIdSchema, req.params.recordId);
    const version = parse(versionSchema, req.params.version);
    const body = parse(releaseSchema, req.body);
    const data = await verificationService.release({ recordId, version, ...body }, requireIdempotencyKey(req));
    return sendSuccess(res, 200, data.duplicate ? 'Release was already committed.' : 'Release committed and QR verification token issued.', data);
  }));
  internal.post('/internal/v1/registrations/:recordId/versions/:version/release', asyncRoute(async (req, res) => {
    const recordId = parse(recordIdSchema, req.params.recordId);
    const version = parse(versionSchema, req.params.version);
    const body = parse(legacyReleaseSchema, req.body || {});
    const data = await verificationService.release({
      recordId,
      version,
      releaseTimestamp: body.releaseTimestamp || new Date().toISOString(),
    }, requireIdempotencyKey(req));
    return sendSuccess(res, 200, data.duplicate ? 'Release was already committed.' : 'Release committed and QR verification token issued.', data);
  }));
  internal.post('/records/:recordId/versions/:version/revoke', asyncRoute(async (req, res) => {
    const recordId = parse(recordIdSchema, req.params.recordId);
    const version = parse(versionSchema, req.params.version);
    const body = parse(revokeSchema, req.body);
    const data = await verificationService.revoke({ recordId, version, ...body }, requireIdempotencyKey(req));
    return sendSuccess(res, 200, data.duplicate ? 'Revocation was already committed.' : 'Record proof and QR tokens revoked.', data);
  }));
  internal.get('/records/:recordId/history', asyncRoute(async (req, res) => {
    const recordId = parse(recordIdSchema, req.params.recordId);
    return sendSuccess(res, 200, 'Ledger history retrieved.', await verificationService.history(recordId));
  }));
  internal.get('/admin/jobs', asyncRoute(async (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
    const items = await repository.listJobs({ limit, status });
    return sendSuccess(res, 200, 'Ledger jobs retrieved.', { items, count: items.length });
  }));
  app.use(internal);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
