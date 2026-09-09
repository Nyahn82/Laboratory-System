import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { FileRecordsRepository } from '../src/repositories/fileRecordsRepository.js';

const SECRET = 'records-test-secret-that-is-long-enough';
const INTERNAL_TOKEN = 'records-test-internal-token-long-enough';
const QR_TOKEN = 'A'.repeat(43);

function token(subject, roles, extra = {}) {
  return jwt.sign({ sub: subject, roles, type: 'access', ...extra }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
}

function headers(subject, roles, key, extra = {}) {
  return { authorization: `Bearer ${token(subject, roles, extra)}`, 'idempotency-key': key };
}

describe('records HTTP workflow', () => {
  let directory;
  let app;
  let repository;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'rhu-records-test-'));
    repository = new FileRecordsRepository({ filePath: path.join(directory, 'records.json') });
    const config = {
      nodeEnv: 'test', port: 0, dbDriver: 'file', recordsDataFile: path.join(directory, 'records.json'),
      authJwtSecret: SECRET, internalServiceToken: INTERNAL_TOKEN,
      storageServiceUrl: 'http://storage.test', verificationServiceUrl: 'http://verification.test',
      publicBaseUrl: 'http://public.test', clientTimeoutMs: 1000, corsOrigins: ['http://localhost:5173'], trustProxy: false,
    };
    const publicationClients = {
      storePackage: async () => ({ envelopeHash: 'a'.repeat(64), objectReference: 'ipfs://encrypted/cid-only', protectedObjectReference: 'protected-object-reference-0001' }),
      registerLedger: async () => ({ transactionId: 'tx-register-1', simulated: true }),
      releaseLedger: async () => ({ transactionId: 'tx-release-1', qrToken: QR_TOKEN, verificationUrl: `http://public.test/verify/${QR_TOKEN}`, simulated: true }),
    };
    app = await createApp({ config, repository, publicationClients });
  });

  afterEach(async () => {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('lists all active patients for doctors and links only their signed current consultation', async () => {
    const registrar = key => headers('cashier-1', ['REGISTRATION_CASHIER'], key);
    const doctor = key => headers('doctor-1', ['DOCTOR'], key);
    const register = async (firstName, key) => (await request(app).post('/patients').set(registrar(key)).send({ firstName, lastName: 'Example', reasonForVisit: 'Checkup', email: 'private@example.test' }).expect(201)).body.data;
    const ana = await register('Ana', 'directory-ana');
    const ben = await register('Ben', 'directory-ben');
    const inactive = await register('Inactive', 'directory-inactive');
    await request(app).delete(`/patients/${inactive.patientId}`).set(registrar('directory-deactivate')).expect(200);
    const consultation = (await request(app).post('/consultations').set(doctor('directory-consult')).send({ patientId: ana.patientId, visitId: ana.visit.visitId, clinicalNotes: 'Private history', assessment: 'Private assessment' }).expect(201)).body.data;
    const directory = await request(app).get('/request-patients?limit=1').set(doctor('directory-read')).expect(200);
    expect(directory.body.data.total).toBe(2);
    expect(directory.body.data.items[0]).toMatchObject({ patientId: ana.patientId, patientName: 'Ana Example', consultationId: consultation.consultationId, visitId: null });
    expect(directory.body.data.items[0]).not.toHaveProperty('email');
    expect(directory.body.data.items[0]).not.toHaveProperty('clinicalNotes');
    const page2 = await request(app).get('/request-patients?limit=1&page=2').set(doctor('directory-page2')).expect(200);
    expect(page2.body.data.items[0]).toMatchObject({ patientId: ben.patientId, consultationId: null, visitId: ben.visit.visitId, reasonForVisit: 'Checkup' });
    const search = await request(app).get('/request-patients?search=Ben').set(doctor('directory-search')).expect(200);
    expect(search.body.data.total).toBe(1);
    const otherDoctor = await request(app).get('/request-patients?search=Ana').set(headers('doctor-2', ['DOCTOR'], 'directory-other')).expect(200);
    expect(otherDoctor.body.data.items[0].consultationId).toBeNull();
    for (const role of ['REGISTRATION_CASHIER', 'LAB_STAFF', 'PATIENT', 'SYSTEM_ADMIN']) {
      await request(app).get('/request-patients').set(headers('other', [role], 'directory-denied')).expect(403);
    }
    await request(app).post('/orders').set(doctor('directory-mismatch')).send({ patientId: ben.patientId, consultationId: consultation.consultationId, testCodes: ['FBS'] }).expect(409);
    await request(app).post('/orders').set(headers('doctor-2', ['DOCTOR'], 'directory-wrong-doctor')).send({ patientId: ana.patientId, consultationId: consultation.consultationId, testCodes: ['FBS'] }).expect(403);
    await request(app).post('/orders').set(doctor('directory-order')).send({ patientId: ana.patientId, consultationId: consultation.consultationId, panelCodes: ['CBC'], testCodes: ['FBS'] }).expect(201);
    const orders = await request(app).get('/orders').set(doctor('directory-orders')).expect(200);
    expect(orders.body.data.items[0]).toMatchObject({ patientName: 'Ana Example', panelCodes: ['CBC'], testNames: ['Fasting Blood Sugar'] });
    const newVisit = (await request(app).post('/visits').set(registrar('directory-new-visit')).send({ patientId: ana.patientId, chiefComplaint: 'New visit' }).expect(201)).body.data;
    const refreshed = await request(app).get('/request-patients?search=Ana').set(doctor('directory-refreshed')).expect(200);
    expect(refreshed.body.data.items[0]).toMatchObject({ consultationId: null, visitId: newVisit.visitId, reasonForVisit: 'New visit' });
  });

  it('filters account activity by exact actor before pagination', async () => {
    for (const [actor, key] of [['cashier-1', 'audit-patient-01'], ['cashier-10', 'audit-patient-10']]) {
      await request(app).post('/patients').set(headers(actor, ['REGISTRATION_CASHIER'], key))
        .send({ firstName: 'Synthetic', lastName: actor, birthDate: '1995-02-03', sex: 'F' }).expect(201);
    }
    const result = await request(app).get('/audit?actorUserId=cashier-1&limit=1&offset=0')
      .set('authorization', `Bearer ${token('admin-1', ['SYSTEM_ADMIN'])}`).expect(200);
    expect(result.body.data.total).toBe(1);
    expect(result.body.data.items[0].actorUserId).toBe('cashier-1');
    await request(app).get('/audit?actorUserId=cashier-1').set('authorization', `Bearer ${token('doctor-1', ['DOCTOR'])}`).expect(403);
  });

  it('serves health, readiness, and a parseable OpenAPI document without authentication', async () => {
    const health = await request(app).get('/health').expect(200);
    expect(health.body).toMatchObject({ success: true, data: { service: 'records-service', status: 'healthy' } });
    const ready = await request(app).get('/ready').expect(200);
    expect(ready.body.data.database).toMatchObject({ ok: true, driver: 'file', simulated: true });
    const specification = await request(app).get('/openapi.json').expect(200);
    expect(specification.body.data.openapi).toBe('3.1.0');
    expect(specification.body.data.paths['/orders/{id}/approval']).toBeTruthy();
  });

  it('enforces RBAC and replays an identical idempotent registration', async () => {
    const body = { firstName: 'Ana', lastName: 'Example', birthDate: '1995-02-03', sex: 'F' };
    await request(app).post('/patients').set(headers('doctor-1', ['DOCTOR'], 'doctor-key-0001')).send(body).expect(403);

    const first = await request(app).post('/patients').set(headers('cashier-1', ['REGISTRATION_CASHIER'], 'patient-key-0001')).send(body).expect(201);
    const replay = await request(app).post('/patients').set(headers('cashier-1', ['REGISTRATION_CASHIER'], 'patient-key-0001')).send(body).expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data.patientId).toBe(first.body.data.patientId);

    const conflictBody = { ...body, lastName: 'Different' };
    const conflict = await request(app).post('/patients').set(headers('cashier-1', ['REGISTRATION_CASHIER'], 'patient-key-0001')).send(conflictBody).expect(409);
    expect(conflict.body.message).toMatch(/different request/i);
  });

  it('persists structured addresses, supports updates, and keeps legacy addresses readable', async () => {
    const actor = (key) => headers('registrar-1', ['REGISTRATION_CASHIER'], key);
    const addressDetails = { houseNumber: ' 12 ', street: ' Sample Street ', barangay: 'Sample Barangay',  province: 'Sample Province', region: 'Sample Region', postalCode: '0123', country: 'Philippines' };
    const created = await request(app).post('/patients').set(actor('structured-patient'))
      .send({ firstName: 'Structured', lastName: 'Patient', addressDetails }).expect(201);
    const patientId = created.body.data.patientId;
    expect(created.body.data.addressDetails).toEqual({ ...addressDetails, houseNumber: '12', street: 'Sample Street', municipality: "M'lang" });
    expect(created.body.data.address).toBe("12 Sample Street, Sample Barangay, M'lang, Sample Province, Sample Region, 0123, Philippines");
    const read = await request(app).get(`/patients/${patientId}`).set(actor('read-structured')).expect(200);
    expect(read.body.data.addressDetails.postalCode).toBe('0123');
    const saved = (await repository.snapshot()).patients.find((item) => item.patientId === patientId);
    expect(saved.addressDetails.barangay).toBe('Sample Barangay');
    const renamed = await request(app).patch(`/patients/${patientId}`).set(actor('rename-structured')).send({ firstName: 'Updated' }).expect(200);
    expect(renamed.body.data.addressDetails).toEqual(created.body.data.addressDetails);
    const moved = await request(app).patch(`/patients/${patientId}`).set(actor('move-structured')).send({ addressDetails: { street: 'New Street', barangay: 'New Barangay' } }).expect(200);
    expect(moved.body.data.address).toBe("New Street, New Barangay, M'lang");
    expect(moved.body.data.addressDetails.houseNumber).toBeNull();
    const cleared = await request(app).patch(`/patients/${patientId}`).set(actor('clear-structured')).send({ addressDetails: null }).expect(200);
    expect(cleared.body.data.address).toBeNull();
    expect(cleared.body.data.addressDetails).toBeNull();
    const legacy = await request(app).post('/patients').set(actor('legacy-patient')).send({ firstName: 'Legacy', lastName: 'Patient', address: 'Original free-text address' }).expect(201);
    const oldRead = await request(app).get(`/patients/${legacy.body.data.patientId}`).set(actor('read-legacy')).expect(200);
    expect(oldRead.body.data.address).toBe('Original free-text address');
    expect(oldRead.body.data.addressDetails).toBeNull();
    for (const [index, invalid] of [{ street: '', barangay: 'Test' }, { street: 'Test', barangay: '   ' }, { street: 'Test', barangay: 'Test', municipality: 'Other City' }].entries()) {
      await request(app).post('/patients').set(actor(`invalid-local-address-${index}`)).send({ firstName: 'Invalid', lastName: 'Patient', addressDetails: invalid }).expect(400);
    }
    const minimal = await request(app).post('/patients').set(actor('minimal-local-patient')).send({ firstName: 'Local', lastName: 'Patient', addressDetails: { street: 'Local Street', barangay: 'Local Barangay' } }).expect(201);
    expect(minimal.body.data).toMatchObject({ middleName: null, suffix: null, contactNumber: null, email: null, addressDetails: { houseNumber: null, municipality: "M'lang" } });
    await request(app).post('/patients').set(actor('invalid-address')).send({ firstName: 'Invalid', lastName: 'Patient', addressDetails: { barangay: 'x'.repeat(121) } }).expect(400);
  });

  it('saves the reason as one visit and lets the doctor review it before ordering tests', async () => {
    const registration = { firstName: 'Reason', lastName: 'Example', reasonForVisit: ' Follow-up visit ' };
    const registrar = key => headers('registrar-1', ['REGISTRATION_CASHIER'], key);
    const doctor = key => headers('doctor-1', ['DOCTOR'], key);
    const first = await request(app).post('/patients').set(registrar('visit-registration-key')).send(registration).expect(201);
    const replay = await request(app).post('/patients').set(registrar('visit-registration-key')).send(registration).expect(201);
    expect(replay.body.data.visit.visitId).toBe(first.body.data.visit.visitId);
    const { patientId, visit } = first.body.data;
    const saved = await repository.snapshot();
    expect(saved.patients).toHaveLength(1); expect(saved.visits).toHaveLength(1);
    expect(saved.visits[0].chiefComplaint).toBe('Follow-up visit');
    expect(saved.labOrders).toHaveLength(0);
    const queue = await request(app).get('/visits?status=OPEN').set(doctor('read-visits')).expect(200);
    expect(queue.body.data.items[0]).toMatchObject({ patientId, visitId: visit.visitId, patientName: 'Reason Example', reasonForVisit: 'Follow-up visit' });
    await request(app).get(`/patients/${patientId}`).set(doctor('read-patient')).expect(200);
    const patients = await request(app).get('/patients').set(doctor('list-patients')).expect(200);
    expect(patients.body.data.items.map(patient => patient.patientId)).toContain(patientId);
    for (const role of ['PATIENT','PUBLIC_VERIFIER','LAB_STAFF','SYSTEM_ADMIN']) {
      await request(app).get('/visits?status=OPEN').set(headers('other', [role], 'read-forbidden')).expect(403);
    }
    await request(app).post('/orders').set(registrar('registrar-order')).send({}).expect(403);
    const review = { patientId, visitId: visit.visitId, chiefComplaint: 'Changed text', clinicalNotes: 'Reviewed patient history.', assessment: 'Further evaluation', plan: 'Discuss next steps.' };
    const consultation = await request(app).post('/consultations').set(doctor('review-visit-key')).send(review).expect(201);
    expect(consultation.body.data).toMatchObject({ visitId: visit.visitId, status: 'COMPLETED', patientId });
    await request(app).post('/consultations').set(doctor('review-visit-key')).send(review).expect(201);
    await request(app).post('/consultations').set(headers('doctor-2', ['DOCTOR'], 'duplicate-review-key')).send(review).expect(409);
    const after = await repository.snapshot();
    expect(after.visits).toHaveLength(1); expect(after.consultations).toHaveLength(1);
    expect(after.visits[0]).toMatchObject({ status: 'CLOSED', chiefComplaint: 'Follow-up visit' });
    const waiting = await request(app).get('/visits?status=OPEN').set(doctor('waiting-after-review')).expect(200);
    expect(waiting.body.data.items).toHaveLength(0);
    await request(app).get(`/patients/${patientId}`).set(headers('doctor-2', ['DOCTOR'], 'not-assigned')).expect(403);
    await request(app).post('/orders').set(doctor('doctor-lab-order')).send({ patientId, consultationId: consultation.body.data.consultationId, testCodes: ['FBS'] }).expect(201);
    const history = await request(app).get('/consultations').set(doctor('read-consultations')).expect(200);
    expect(history.body.data.items[0].chiefComplaint).toBe('Follow-up visit');
    await request(app).post('/patients').set(registrar('blank-visit-reason')).send({ ...registration, reasonForVisit: '   ' }).expect(400);
  });

  it('completes the payment-free role-protected workflow and preserves the released result version', async () => {
    const patientResponse = await request(app).post('/patients')
      .set(headers('cashier-1', ['REGISTRATION_CASHIER'], 'patient-flow-0001'))
      .send({ firstName: 'Synthetic', lastName: 'Patient', birthDate: '1999-04-12', sex: 'Other', address: 'Test address' }).expect(201);
    const patientId = patientResponse.body.data.patientId;

    await request(app).post(`/patients/${patientId}/link`)
      .set(headers('cashier-1', ['REGISTRATION_CASHIER'], 'patient-link-0001'))
      .send({ authUserId: 'patient-user-1' }).expect(201);

    const consultationResponse = await request(app).post('/consultations')
      .set(headers('doctor-1', ['DOCTOR'], 'consult-key-0001'))
      .send({ patientId, chiefComplaint: 'Fatigue', clinicalNotes: 'Synthetic notes.', assessment: 'Laboratory evaluation', plan: 'Review after release.' }).expect(201);
    expect(consultationResponse.body.data.status).toBe('COMPLETED');
    const consultationId = consultationResponse.body.data.consultationId;

    const orderResponse = await request(app).post('/orders')
      .set(headers('doctor-1', ['DOCTOR'], 'order-key-0001'))
      .send({ patientId, consultationId, priority: 'Routine', clinicalReason: 'CBC check', testCodes: ['HGB'] }).expect(201);
    const orderId = orderResponse.body.data.orderId;

    expect(orderResponse.body.data.status).toBe('REQUESTED');
    const queue = await request(app).get('/dashboard').set('authorization', `Bearer ${token('lab-1', ['LAB_STAFF'])}`).expect(200);
    expect(queue.body.data.awaitingCollection).toBe(1);
    for (const command of ['payment', 'payment-classification']) {
      await request(app).post(`/orders/${orderId}/${command}`)
        .set(headers('cashier-1', ['REGISTRATION_CASHIER'], `disabled-${command}`))
        .send({ classification: 'Free', reason: 'Deferred', remarks: 'Deferred' }).expect(404);
    }
    await request(app).post(`/orders/${orderId}/accession`)
      .set(headers('cashier-1', ['REGISTRATION_CASHIER'], 'forbidden-accession'))
      .send({ sampleType: 'Whole Blood', specimenCode: 'SP-FORBIDDEN' }).expect(403);

    await request(app).post(`/orders/${orderId}/accession`)
      .set(headers('lab-1', ['LAB_STAFF'], 'accession-key-01'))
      .send({ sampleType: 'Whole Blood', specimenCode: 'SP-FLOW-1' }).expect(201);
    await request(app).post(`/orders/${orderId}/collection`)
      .set(headers('lab-1', ['LAB_STAFF'], 'collect-key-0001'))
      .send({ collectedAt: new Date().toISOString(), condition: 'Acceptable' }).expect(200);
    await request(app).post(`/orders/${orderId}/results`)
      .set(headers('lab-1', ['LAB_STAFF'], 'result-key-00001'))
      .send({ testCode: 'HGB', testName: 'Hemoglobin', resultValue: '15', numericValue: 15, unit: 'g/dL' }).expect(201);
    await request(app).post(`/orders/${orderId}/qc`)
      .set(headers('lab-1', ['LAB_STAFF'], 'qc-key-00000001'))
      .send({ passed: true, controlLot: 'QC-1', controlValue: 'within range' }).expect(201);
    const submitted = await request(app).post(`/orders/${orderId}/submit`)
      .set(headers('lab-1', ['LAB_STAFF'], 'submit-key-0001')).send({ remarks: 'Complete' }).expect(200);
    const versionId = submitted.body.data.resultVersion.resultVersionId;

    await request(app).post(`/orders/${orderId}/approval`)
      .set(headers('lab-1', ['LAB_STAFF'], 'bad-approval-001'))
      .send({ decision: 'approve', remarks: 'Not authorized' }).expect(403);
    const approved = await request(app).post(`/orders/${orderId}/approval`)
      .set(headers('supervisor-1', ['LAB_SUPERVISOR'], 'approval-key-001'))
      .send({ decision: 'approve', remarks: 'Approved' }).expect(200);
    expect(approved.body.data.resultVersion.publicationStatus).toBe('REGISTERED');

    const released = await request(app).post(`/orders/${orderId}/release`)
      .set(headers('supervisor-1', ['LAB_SUPERVISOR'], 'release-key-0001'))
      .send({ remarks: 'Release' }).expect(200);
    expect(released.body.data.verificationToken).toBe(QR_TOKEN);

    await request(app).post(`/orders/${orderId}/doctor-review`)
      .set(headers('doctor-1', ['DOCTOR'], 'review-key-00001'))
      .send({ acknowledgment: true, interpretation: 'Reviewed.', followUpPlan: 'Routine follow-up.' }).expect(201);

    const own = await request(app).get('/me/results').set('authorization', `Bearer ${token('patient-user-1', ['PATIENT'], { patientId })}`).expect(200);
    expect(own.body.data.items).toHaveLength(1);
    expect(own.body.data.items[0].order.orderId).toBe(orderId);

    const immutable = await request(app).put(`/result-versions/${versionId}/items`)
      .set(headers('lab-1', ['LAB_STAFF'], 'overwrite-key-01'))
      .send({ items: [{ testId: 'test-hgb', resultValue: '16', numericValue: 16, unit: 'g/dL' }] }).expect(409);
    expect(immutable.body.message).toMatch(/immutable/i);

    const correction = await request(app).post(`/result-versions/${versionId}/corrections`)
      .set(headers('supervisor-1', ['LAB_SUPERVISOR'], 'correct-key-0001')).send({}).expect(201);
    expect(correction.body.data.versionNumber).toBe(2);
    const original = await request(app).get(`/result-versions/${versionId}`).set('authorization', `Bearer ${token('supervisor-1', ['LAB_SUPERVISOR'])}`).expect(200);
    expect(original.body.data.resultVersion.versionNumber).toBe(1);
    expect(original.body.data.items[0].resultValue).toBe('15');
  });
});
