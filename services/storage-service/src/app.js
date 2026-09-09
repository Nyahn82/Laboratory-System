import express from 'express';
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

const recordIdSchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const versionSchema = z.coerce.number().int().positive();
const createSchema = z.object({
  recordId: recordIdSchema,
  version: z.number().int().positive(),
  record: z.record(z.string(), z.unknown()),
}).strict();
const legacyCreateSchema = z.object({
  opaqueRecordId: recordIdSchema,
  version: z.number().int().positive(),
  snapshot: z.record(z.string(), z.unknown()),
}).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, 'Request validation failed.', result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })), 'VALIDATION_FAILED');
  }
  return result.data;
}

export function createApp({ config, packageService, repository, objectStore }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(standardSecurity({ isPublic: false }));
  app.use(requestContext);
  app.use(express.json({ limit: config.maxJsonBytes }));
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => logger.info('http_request', { requestId: req.requestId, status: res.statusCode }));
    req.startedAt = started;
    next();
  });

  app.get('/health', (_req, res) => sendSuccess(res, 200, 'Storage service is alive.', {
    service: 'storage-service',
    status: 'healthy',
    adapter: objectStore.provider,
    objectStoreDriver: config.objectStoreDriver || objectStore.provider,
    dbDriver: config.dbDriver || repository.provider,
    simulated: Boolean(objectStore.simulated || repository.simulated),
  }));
  app.get('/ready', asyncRoute(async (_req, res) => {
    const [database, objectStorage] = await Promise.all([repository.health(), objectStore.health()]);
    const ready = database.ok && objectStorage.ok;
    return sendSuccess(res, ready ? 200 : 503, ready ? 'Storage service is ready.' : 'Storage service dependencies are unavailable.', {
      service: 'storage-service',
      status: ready ? 'ready' : 'not-ready',
      adapter: objectStorage.provider,
      objectStoreDriver: config.objectStoreDriver || objectStorage.provider,
      dbDriver: config.dbDriver || database.provider,
      simulated: Boolean(objectStorage.simulated || database.simulated),
      dependencies: { metadata: database, objectStorage },
    });
  }));
  app.get('/openapi.json', (_req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Storage Service API' }));

  const internal = express.Router();
  internal.use(requireInternalToken(config.internalServiceToken));
  const createPackage = (schema, normalize = (value) => value) => asyncRoute(async (req, res) => {
    const body = normalize(parse(schema, req.body));
    const data = await packageService.create({ ...body, idempotencyKey: requireIdempotencyKey(req) });
    return sendSuccess(res, data.duplicate ? 200 : 201, data.duplicate ? 'Encrypted package already exists.' : 'Encrypted package created.', data);
  });
  internal.post('/packages', createPackage(createSchema));
  internal.post('/internal/v1/packages', createPackage(legacyCreateSchema, (body) => ({
    recordId: body.opaqueRecordId,
    version: body.version,
    record: body.snapshot,
  })));
  internal.get('/packages/:recordId/versions/:version', asyncRoute(async (req, res) => {
    const recordId = parse(recordIdSchema, req.params.recordId);
    const version = parse(versionSchema, req.params.version);
    const data = await packageService.retrieve({ recordId, version, callerService: req.callerService, requestId: req.requestId });
    return sendSuccess(res, 200, 'Encrypted package retrieved and verified.', data);
  }));
  internal.post('/packages/:recordId/versions/:version/verify', asyncRoute(async (req, res) => {
    const recordId = parse(recordIdSchema, req.params.recordId);
    const version = parse(versionSchema, req.params.version);
    const data = await packageService.verify({ recordId, version, callerService: req.callerService, requestId: req.requestId });
    return sendSuccess(res, 200, 'Encrypted package integrity verified.', data);
  }));
  internal.get('/admin/jobs', asyncRoute(async (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
    const jobs = await repository.listJobs({ limit, status });
    return sendSuccess(res, 200, 'Storage jobs retrieved.', { items: jobs, count: jobs.length });
  }));
  app.use(internal);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
