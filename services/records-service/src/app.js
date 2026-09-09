import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { loadConfig } from './config.js';
import { createRecordsRepository } from './repositories/index.js';
import { createPublicationClients } from './clients/publicationClients.js';
import { RecordsService } from './services/recordsService.js';
import { ApiError } from './errors.js';
import {
  allowRoles,
  asyncRoute,
  authenticate,
  errorHandler,
  notFound,
  requestContext,
  requireIdempotencyKey,
  securityMiddleware,
  sendSuccess,
  validate,
} from './http.js';
import {
  accessionSchema,
  accountLinkSchema,
  approvalSchema,
  attemptCreateSchema,
  attemptUpdateSchema,
  collectSchema,
  consultationRequestSchema,
  consultationUpdateSchema,
  directAccessionSchema,
  directApprovalSchema,
  directDoctorReviewSchema,
  directQcSchema,
  directResultSchema,
  doctorReviewSchema,
  idParams,
  orderRequestSchema,
  paginationQuery,
  patientRegistrationSchema,
  patientUpdateSchema,
  qcSchema,
  receiveSchema,
  referralResultSchema,
  referralSchema,
  rejectSchema,
  rejectionSchema,
  releaseSchema,
  repeatSchema,
  resultItemsSchema,
  resultVersionCreateSchema,
  syncBatchSchema,
  visitSchema,
} from './schemas.js';

const REGISTRATION = ['REGISTRATION_CASHIER'];
const DOCTOR = ['DOCTOR'];
const LAB = ['LAB_STAFF'];
const SUPERVISOR = ['LAB_SUPERVISOR'];
const CLINICAL_READ = ['REGISTRATION_CASHIER', 'DOCTOR', 'LAB_STAFF', 'LAB_SUPERVISOR'];

function context(req) {
  return { requestId: req.requestId, ipAddress: req.ip, deviceId: req.get('x-device-id') || null, source: 'http' };
}

function routeScope(req) {
  return `${req.method}:${req.baseUrl}${req.route.path}`;
}

function command(service, operation, defaultStatus = 200, defaultMessage = 'Operation completed.') {
  return asyncRoute(async (req, res) => {
    const key = requireIdempotencyKey(req);
    const result = await service.command({
      key,
      user: req.user,
      scope: routeScope(req),
      input: { params: req.validated?.params || req.params, body: req.validated?.body || req.body },
    }, async () => {
      const output = await operation(req);
      if (output && typeof output === 'object' && Object.hasOwn(output, '_response')) return output._response;
      return { status: defaultStatus, message: defaultMessage, data: output };
    });
    if (result.replayed) res.setHeader('idempotency-replayed', 'true');
    return sendSuccess(res, result.status, result.message, result.data);
  });
}

async function normalizeOrderInput(service, body) {
  if (!body.panelCodes && !body.testCodes) return body;
  const catalog = await service.catalog();
  const panelIds = body.panelCodes.map((code) => catalog.panels.find((item) => item.panelCode.toLowerCase() === code.toLowerCase())?.panelId);
  const testIds = body.testCodes.map((code) => catalog.tests.find((item) => item.testCode.toLowerCase() === code.toLowerCase())?.testId);
  const unknownPanels = body.panelCodes.filter((_code, index) => !panelIds[index]);
  const unknownTests = body.testCodes.filter((_code, index) => !testIds[index]);
  if (unknownPanels.length || unknownTests.length) {
    throw new ApiError(400, 'One or more laboratory catalog codes are unknown.', 'CATALOG_CODE_INVALID', [
      ...unknownPanels.map((value) => ({ field: 'panelCodes', value })),
      ...unknownTests.map((value) => ({ field: 'testCodes', value })),
    ]);
  }
  return {
    consultationId: body.consultationId,
    patientId: body.patientId,
    panelIds,
    testIds,
    priority: body.priority,
    clinicalNotes: body.clinicalReason,
  };
}

async function normalizeAccessionInput(service, body) {
  const catalog = await service.catalog();
  const normalizedName = body.sampleType.toLowerCase().replace(/^whole\s+/, '');
  const sample = catalog.sampleTypes.find((item) => item.sampleName.toLowerCase().replace(/^whole\s+/, '') === normalizedName || item.sampleTypeId === body.sampleType);
  if (!sample) throw new ApiError(400, 'The sample type is not in the active laboratory catalog.', 'SAMPLE_TYPE_INVALID');
  return { specimens: [{ sampleTypeId: sample.sampleTypeId, condition: body.condition, remarks: body.remarks }], specimenCode: body.specimenCode };
}

export async function createApp(options = {}) {
  const config = options.config || loadConfig();
  const repository = options.repository || createRecordsRepository(config);
  const publicationClients = options.publicationClients || createPublicationClients(config);
  const service = options.service || new RecordsService({ repository, publicationClients, config });
  await service.initialize();

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(requestContext);
  app.use(...securityMiddleware(config));
  app.use(express.json({ limit: '2mb' }));

  const openapiPath = fileURLToPath(new URL('../openapi.yaml', import.meta.url));
  const openapiDocument = YAML.parse(await readFile(openapiPath, 'utf8'));
  app.get('/health', (_req, res) => sendSuccess(res, 200, 'Records service is healthy.', { status: 'healthy', service: 'records-service', timestamp: new Date().toISOString() }));
  app.get('/ready', asyncRoute(async (_req, res) => {
    const ready = await service.readiness();
    return sendSuccess(res, ready.status === 'ready' ? 200 : 503, ready.status === 'ready' ? 'Records service is ready.' : 'Records service is not ready.', ready);
  }));
  app.get('/openapi.json', (_req, res) => sendSuccess(res, 200, 'OpenAPI document.', openapiDocument));
  app.get('/openapi.yaml', asyncRoute(async (_req, res) => { res.type('application/yaml').send(await readFile(openapiPath, 'utf8')); }));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument, { customSiteTitle: 'RHU Records API' }));

  const v1 = express.Router();
  v1.use(authenticate(config.authJwtSecret));

  v1.get('/dashboard', allowRoles('SYSTEM_ADMIN', ...CLINICAL_READ, 'PATIENT'), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Dashboard loaded.', await service.dashboard(req.user))));

  v1.get('/request-patients', allowRoles(...DOCTOR), validate({ query: paginationQuery }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Patients loaded.', await service.listRequestPatients(req.user, req.validated.query))));
  v1.get('/patients', allowRoles(...CLINICAL_READ), validate({ query: paginationQuery }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Patients loaded.', await service.listPatients(req.user, req.validated.query))));
  v1.post('/patients', allowRoles(...REGISTRATION), validate({ body: patientRegistrationSchema }), command(service, (req) => service.createPatient(req.validated.body, req.user, context(req)), 201, 'Patient created.'));
  v1.get('/patients/:id', allowRoles(...CLINICAL_READ), validate({ params: idParams }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Patient loaded.', await service.getPatient(req.user, req.validated.params.id))));
  v1.patch('/patients/:id', allowRoles(...REGISTRATION), validate({ params: idParams, body: patientUpdateSchema }), command(service, (req) => service.updatePatient(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Patient updated.'));
  v1.delete('/patients/:id', allowRoles(...REGISTRATION), validate({ params: idParams }), command(service, (req) => service.deactivatePatient(req.validated.params.id, req.user, context(req)), 200, 'Patient deactivated.'));
  v1.post('/patients/:id/account-links', allowRoles(...REGISTRATION), validate({ params: idParams, body: accountLinkSchema }), command(service, (req) => service.linkPatientAccount(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Patient account linked.'));
  v1.post('/patients/:id/link', allowRoles(...REGISTRATION), validate({ params: idParams, body: accountLinkSchema }), command(service, (req) => service.linkPatientAccount(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Patient account linked.'));

  v1.get('/visits', allowRoles(...REGISTRATION, ...DOCTOR), validate({ query: paginationQuery }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Visits loaded.', await service.listVisits(req.user, req.validated.query))));
  v1.post('/visits', allowRoles(...REGISTRATION), validate({ body: visitSchema }), command(service, (req) => service.createVisit(req.validated.body, req.user, context(req)), 201, 'Visit created.'));

  v1.get('/consultations', allowRoles(...CLINICAL_READ), validate({ query: paginationQuery }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Consultations loaded.', await service.listConsultations(req.user, req.validated.query))));
  v1.post('/consultations', allowRoles(...DOCTOR), validate({ body: consultationRequestSchema }), command(service, (req) => {
    const body = req.validated.body;
    return service.createConsultation(body.diagnosis ? body : { ...body, diagnosis: body.assessment, autoComplete: true }, req.user, context(req));
  }, 201, 'Consultation created.'));
  v1.patch('/consultations/:id', allowRoles(...DOCTOR), validate({ params: idParams, body: consultationUpdateSchema }), command(service, (req) => service.updateConsultation(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Consultation updated.'));
  v1.post('/consultations/:id/complete', allowRoles(...DOCTOR), validate({ params: idParams, body: approvalSchema }), command(service, (req) => service.completeConsultation(req.validated.params.id, req.user, context(req)), 200, 'Consultation completed.'));

  v1.get('/catalog', allowRoles(...CLINICAL_READ), asyncRoute(async (_req, res) => sendSuccess(res, 200, 'Laboratory catalog loaded.', await service.catalog())));
  v1.get('/catalog/tests', allowRoles(...CLINICAL_READ), asyncRoute(async (_req, res) => sendSuccess(res, 200, 'Tests loaded.', { items: (await service.catalog()).tests })));
  v1.get('/catalog/panels', allowRoles(...CLINICAL_READ), asyncRoute(async (_req, res) => sendSuccess(res, 200, 'Panels loaded.', { items: (await service.catalog()).panels })));
  v1.get('/catalog/sample-types', allowRoles(...CLINICAL_READ), asyncRoute(async (_req, res) => sendSuccess(res, 200, 'Sample types loaded.', { items: (await service.catalog()).sampleTypes })));

  v1.get('/orders', allowRoles(...CLINICAL_READ), validate({ query: paginationQuery }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Orders loaded.', await service.listOrders(req.user, req.validated.query))));
  v1.post('/orders', allowRoles(...DOCTOR), validate({ body: orderRequestSchema }), command(service, async (req) => service.createOrder(await normalizeOrderInput(service, req.validated.body), req.user, context(req)), 201, 'Laboratory order created.'));
  v1.get('/orders/:id', allowRoles(...CLINICAL_READ), validate({ params: idParams }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Order loaded.', await service.getOrder(req.user, req.validated.params.id))));
  v1.post('/orders/:id/accessions', allowRoles(...LAB), validate({ params: idParams, body: accessionSchema }), command(service, (req) => service.accessionOrder(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Order accessioned.'));

  v1.post('/orders/:id/accession', allowRoles(...LAB), validate({ params: idParams, body: directAccessionSchema }), command(service, async (req) => service.accessionOrder(req.validated.params.id, await normalizeAccessionInput(service, req.validated.body), req.user, context(req)), 201, 'Order accessioned.'));
  v1.post('/orders/:id/collection', allowRoles(...LAB), validate({ params: idParams, body: collectSchema }), command(service, (req) => service.collectOrderSpecimens(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Specimen collected.'));
  v1.post('/orders/:id/receive', allowRoles(...LAB), validate({ params: idParams, body: receiveSchema }), command(service, (req) => service.receiveOrderSpecimens(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Specimen received.'));
  v1.post('/orders/:id/rejection', allowRoles(...LAB), validate({ params: idParams, body: rejectSchema }), command(service, (req) => service.rejectOrderSpecimens(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Specimen rejected.'));

  v1.post('/specimens/:id/collect', allowRoles(...LAB), validate({ params: idParams, body: collectSchema }), command(service, (req) => service.collectSpecimen(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Specimen collected.'));
  v1.post('/specimens/:id/receive', allowRoles(...LAB), validate({ params: idParams, body: receiveSchema }), command(service, (req) => service.receiveSpecimen(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Specimen received.'));
  v1.post('/specimens/:id/reject', allowRoles(...LAB), validate({ params: idParams, body: rejectSchema }), command(service, (req) => service.rejectSpecimen(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Specimen rejected.'));

  v1.post('/orders/:id/result-versions', allowRoles(...LAB, ...SUPERVISOR), validate({ params: idParams, body: resultVersionCreateSchema }), command(service, (req) => service.createResultVersion(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Result version created.'));
  v1.get('/result-versions/:id', allowRoles(...DOCTOR, ...LAB, ...SUPERVISOR), validate({ params: idParams }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Result version loaded.', await service.getVersionForRole(req.user, req.validated.params.id))));
  v1.put('/result-versions/:id/items', allowRoles(...LAB), validate({ params: idParams, body: resultItemsSchema }), command(service, (req) => service.replaceDraftItems(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Draft result items saved.'));
  v1.post('/order-items/:id/test-attempts', allowRoles(...LAB), validate({ params: idParams, body: attemptCreateSchema }), command(service, (req) => service.createTestAttempt(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Test attempt started.'));
  v1.patch('/test-attempts/:id', allowRoles(...LAB), validate({ params: idParams, body: attemptUpdateSchema }), command(service, (req) => service.enterAttemptResult(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Result entered.'));
  v1.post('/test-attempts/:id/qc-checks', allowRoles(...LAB), validate({ params: idParams, body: qcSchema }), command(service, (req) => service.recordQc(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'QC check recorded.'));
  v1.post('/test-attempts/:id/repeat-tests', allowRoles(...LAB), validate({ params: idParams, body: repeatSchema }), command(service, (req) => service.createRepeat(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Repeat test started.'));
  v1.post('/test-attempts/:id/referrals', allowRoles(...LAB), validate({ params: idParams, body: referralSchema }), command(service, (req) => service.createReferral(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Referral created.'));
  v1.post('/referrals/:id/results', allowRoles(...LAB), validate({ params: idParams, body: referralResultSchema }), command(service, (req) => service.incorporateReferralResult(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Referral result incorporated.'));

  v1.post('/orders/:id/results', allowRoles(...LAB), validate({ params: idParams, body: directResultSchema }), command(service, (req) => service.enterOrderResult(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Result entered.'));
  v1.post('/orders/:id/qc', allowRoles(...LAB), validate({ params: idParams, body: directQcSchema }), command(service, (req) => service.recordOrderQc(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'QC check recorded.'));
  v1.post('/orders/:id/repeat-tests', allowRoles(...LAB), validate({ params: idParams, body: repeatSchema }), command(service, (req) => service.startOrderRepeat(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Repeat test started.'));
  v1.post('/orders/:id/referrals', allowRoles(...LAB), validate({ params: idParams, body: referralSchema }), command(service, (req) => service.referOrderResult(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Referral created.'));
  v1.post('/orders/:id/submit', allowRoles(...LAB), validate({ params: idParams, body: approvalSchema }), command(service, (req) => service.submitOrder(req.validated.params.id, req.user, context(req)), 200, 'Result submitted for verification.'));
  v1.post('/orders/:id/approval', allowRoles(...SUPERVISOR), validate({ params: idParams, body: directApprovalSchema }), command(service, async (req) => {
    const data = await service.decideOrder(req.validated.params.id, req.validated.body, req.user, context(req));
    const version = data.resultVersion || data.rejectedVersion;
    const complete = req.validated.body.decision === 'reject' || version?.publicationStatus === 'REGISTERED';
    const completedMessage = req.validated.body.decision === 'approve' ? 'Result approved.' : 'Result rejected.';
    return { _response: { status: complete ? 200 : 202, message: complete ? completedMessage : 'Result approved; publication is queued for retry.', data } };
  }));
  v1.post('/orders/:id/release', allowRoles(...SUPERVISOR), validate({ params: idParams, body: releaseSchema }), command(service, async (req) => {
    const data = await service.releaseOrder(req.validated.params.id, req.validated.body, req.user, context(req));
    const complete = data.resultVersion?.publicationStatus === 'COMPLETE';
    return { _response: { status: complete ? 200 : 202, message: complete ? 'Result released.' : 'Release is queued for retry.', data } };
  }));
  v1.post('/orders/:id/doctor-review', allowRoles(...DOCTOR), validate({ params: idParams, body: directDoctorReviewSchema }), command(service, (req) => service.reviewOrderRelease(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Doctor review recorded.'));
  v1.post('/result-versions/:id/submit', allowRoles(...LAB), validate({ params: idParams, body: approvalSchema }), command(service, (req) => service.submitVersion(req.validated.params.id, req.user, context(req)), 200, 'Result submitted for verification.'));
  v1.post('/result-versions/:id/approve', allowRoles(...SUPERVISOR), validate({ params: idParams, body: approvalSchema }), command(service, async (req) => {
    const data = await service.approveVersion(req.validated.params.id, req.validated.body, req.user, context(req));
    const complete = data.resultVersion.publicationStatus === 'REGISTERED';
    return { _response: { status: complete ? 200 : 202, message: complete ? 'Result approved and publication registered.' : 'Result approved; publication is queued for retry.', data } };
  }));
  v1.post('/result-versions/:id/reject', allowRoles(...SUPERVISOR), validate({ params: idParams, body: rejectionSchema }), command(service, (req) => service.rejectVersion(req.validated.params.id, req.validated.body, req.user, context(req)), 200, 'Result rejected and a new draft version created.'));
  v1.post('/result-versions/:id/corrections', allowRoles(...SUPERVISOR), validate({ params: idParams, body: approvalSchema }), command(service, (req) => service.createCorrection(req.validated.params.id, req.user, context(req)), 201, 'Correction version created.'));
  v1.post('/result-versions/:id/publication/finalize', allowRoles(...SUPERVISOR), validate({ params: idParams, body: approvalSchema }), command(service, async (req) => ({ publication: await service.processPublication(req.validated.params.id), version: await service.getVersionForRole(req.user, req.validated.params.id) }), 200, 'Publication processing completed.'));
  v1.post('/result-versions/:id/finalize', allowRoles(...SUPERVISOR), validate({ params: idParams, body: approvalSchema }), command(service, async (req) => ({ publication: await service.processPublication(req.validated.params.id), version: await service.getVersionForRole(req.user, req.validated.params.id) }), 200, 'Publication processing completed.'));
  v1.post('/result-versions/:id/release', allowRoles(...SUPERVISOR), validate({ params: idParams, body: releaseSchema }), command(service, async (req) => {
    const data = await service.releaseVersion(req.validated.params.id, req.validated.body, req.user, context(req));
    const complete = data.resultVersion.publicationStatus === 'COMPLETE';
    return { _response: { status: complete ? 200 : 202, message: complete ? 'Result released.' : 'Release is queued for retry.', data } };
  }));

  v1.post('/releases/:id/doctor-reviews', allowRoles(...DOCTOR), validate({ params: idParams, body: doctorReviewSchema }), command(service, (req) => service.recordDoctorReview(req.validated.params.id, req.validated.body, req.user, context(req)), 201, 'Doctor review recorded.'));
  v1.get('/me/lab-results', allowRoles('PATIENT'), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Released laboratory results loaded.', { items: await service.ownReleasedResults(req.user) })));
  v1.get('/me/lab-results/:id', allowRoles('PATIENT'), validate({ params: idParams }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Released laboratory result loaded.', await service.ownReleasedResult(req.user, req.validated.params.id))));
  v1.get('/me/results', allowRoles('PATIENT'), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Released laboratory results loaded.', { items: await service.ownReleasedResults(req.user) })));
  v1.get('/me/results/:id', allowRoles('PATIENT'), validate({ params: idParams }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Released laboratory result loaded.', await service.ownReleasedResult(req.user, req.validated.params.id))));

  v1.get('/audit', allowRoles('SYSTEM_ADMIN', ...SUPERVISOR), validate({ query: paginationQuery }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Audit records loaded.', await service.listAudit(req.validated.query))));
  v1.get('/outbox', allowRoles('SYSTEM_ADMIN', ...SUPERVISOR), validate({ query: paginationQuery }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Outbox loaded.', await service.listOutbox(req.validated.query))));
  v1.post('/outbox/:id/retry', allowRoles('SYSTEM_ADMIN', ...SUPERVISOR), validate({ params: idParams, body: approvalSchema }), command(service, (req) => service.retryOutbox(req.validated.params.id), 200, 'Outbox event retried.'));
  v1.post('/sync/batches', allowRoles(...REGISTRATION, ...DOCTOR, ...LAB), validate({ body: syncBatchSchema }), command(service, (req) => service.syncBatch(req.validated.body, req.user, context(req)), 200, 'Sync batch processed.'));
  v1.get('/sync/receipts/:id', allowRoles('SYSTEM_ADMIN', ...REGISTRATION, ...DOCTOR, ...LAB), validate({ params: idParams }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Sync receipt loaded.', await service.getSyncReceipt(req.validated.params.id, req.user))));

  v1.get('/sync/outbox', allowRoles('SYSTEM_ADMIN', ...SUPERVISOR), validate({ query: paginationQuery }), asyncRoute(async (req, res) => sendSuccess(res, 200, 'Outbox loaded.', await service.listOutbox(req.validated.query))));
  v1.post('/sync/outbox/:id/retry', allowRoles('SYSTEM_ADMIN', ...SUPERVISOR), validate({ params: idParams, body: approvalSchema }), command(service, (req) => service.retryOutbox(req.validated.params.id), 200, 'Outbox event retried.'));
  v1.post('/sync/events', allowRoles(...REGISTRATION, ...DOCTOR, ...LAB), validate({ body: syncBatchSchema }), command(service, (req) => service.syncBatch(req.validated.body, req.user, context(req)), 200, 'Sync batch processed.'));

  // Nginx strips /api/records/, so the documented API is mounted at the
  // service root. /v1 remains available to explicit versioned clients.
  app.use(v1);
  app.use('/v1', v1);
  app.use(notFound);
  app.use(errorHandler);
  app.locals.recordsService = service;
  app.locals.repository = repository;
  app.locals.config = config;
  return app;
}
