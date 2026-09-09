import { expect, test } from '@playwright/test';

const seedPassword = process.env.DEV_SEED_PASSWORD;
const nextPassword = process.env.E2E_ACCOUNT_PASSWORD;

async function login(request, email) {
  if (!seedPassword) throw new Error('DEV_SEED_PASSWORD is required for the local E2E test.');
  let response = await request.post('/api/auth/login', { data: { email, password: seedPassword } });
  if (!response.ok() && nextPassword) response = await request.post('/api/auth/login', { data: { email, password: nextPassword } });
  expect(response.ok(), `login ${email}`).toBeTruthy();
  let payload = await response.json();
  let token = payload.data.accessToken;
  let user = payload.data.user;
  if (payload.data.user?.mustChangePassword) {
    if (!nextPassword) throw new Error('E2E_ACCOUNT_PASSWORD is required to rotate seed passwords.');
    const change = await request.post('/api/auth/password/change', { headers: { authorization: `Bearer ${token}` }, data: { currentPassword: seedPassword, newPassword: nextPassword } });
    expect(change.ok(), `change seed password ${email}`).toBeTruthy();
    const changedPayload = await change.json();
    token = changedPayload.data.accessToken || token;
    user = changedPayload.data.user || { ...user, mustChangePassword: false };
  }
  return { token, user };
}

function headers(token, key = crypto.randomUUID()) {
  return { authorization: `Bearer ${token}`, 'idempotency-key': key };
}

async function dataOf(response, label) {
  const payload = await response.json();
  expect(response.ok(), `${label}: ${JSON.stringify(payload)}`).toBeTruthy();
  expect(payload.success).toBe(true);
  return payload.data;
}

test('synthetic record completes the protected laboratory and public verification journey', async ({ request }) => {
  test.skip(!process.env.E2E_BASE_URL, 'Set E2E_BASE_URL to an already running native or Docker stack.');
  if (!nextPassword) throw new Error('E2E_ACCOUNT_PASSWORD is required for a repeatable synthetic patient account.');
  const administrator = await login(request, process.env.E2E_ADMIN_EMAIL || 'admin@lab.local');
  const registrar = await login(request, process.env.E2E_REGISTRAR_EMAIL || 'cashier@lab.local');
  const doctor = await login(request, process.env.E2E_DOCTOR_EMAIL || 'doctor@lab.local');
  const laboratory = await login(request, process.env.E2E_LAB_EMAIL || 'labstaff@lab.local');
  const supervisor = await login(request, process.env.E2E_SUPERVISOR_EMAIL || 'supervisor@lab.local');

  const unique = Date.now().toString(36);
  const patientEmail = `e2e.patient.${unique}@lab.local`;
  await dataOf(await request.post('/api/auth/users', {
    headers: headers(administrator.token),
    data: {
      email: patientEmail,
      firstName: 'Synthetic',
      lastName: `Account-${unique}`,
      password: nextPassword,
      status: 'ACTIVE',
      mustChangePassword: false,
      roleCodes: ['PATIENT'],
    },
  }), 'create synthetic patient account');
  const patientAccount = await login(request, patientEmail);

  const patient = await dataOf(await request.post('/api/records/patients', {
    headers: headers(registrar.token),
    data: { firstName: 'Synthetic', lastName: `Patient-${unique}`, birthDate: '1999-04-12', sex: 'Other', contactNumber: '0000000000', address: 'Synthetic Test Address' },
  }), 'register patient');
  const patientId = patient.patient?.id || patient.id || patient.patientId;

  await dataOf(await request.post(`/api/records/patients/${patientId}/link`, {
    headers: headers(registrar.token), data: { authUserId: patientAccount.user.id || patientAccount.user.userId },
  }), 'link patient account');

  const consultation = await dataOf(await request.post('/api/records/consultations', {
    headers: headers(doctor.token), data: { patientId, chiefComplaint: 'Synthetic fatigue case', clinicalNotes: 'E2E synthetic record only.', assessment: 'Laboratory evaluation requested.', plan: 'Review after release.' },
  }), 'create consultation');
  const consultationId = consultation.consultation?.id || consultation.id || consultation.consultationId;

  const order = await dataOf(await request.post('/api/records/orders', {
    headers: headers(doctor.token), data: { patientId, consultationId, priority: 'Routine', clinicalReason: 'Synthetic hemoglobin verification flow', panelCodes: [], testCodes: ['HGB'] },
  }), 'create order');
  const orderId = order.order?.id || order.id || order.orderId;

  await dataOf(await request.post(`/api/records/orders/${orderId}/accession`, { headers: headers(laboratory.token), data: { sampleType: 'Whole Blood', specimenCode: `SP-${unique}` } }), 'accession specimen');
  await dataOf(await request.post(`/api/records/orders/${orderId}/collection`, { headers: headers(laboratory.token), data: { collectedAt: new Date().toISOString(), condition: 'Acceptable' } }), 'collect specimen');
  await dataOf(await request.post(`/api/records/orders/${orderId}/results`, { headers: headers(laboratory.token), data: { testCode: 'HGB', testName: 'Hemoglobin', resultValue: '15', numericValue: 15, unit: 'g/dL', referenceRange: '13 - 17' } }), 'enter result');
  await dataOf(await request.post(`/api/records/orders/${orderId}/qc`, { headers: headers(laboratory.token), data: { passed: true, controlLot: `QC-${unique}`, controlValue: 'within range' } }), 'pass QC');
  await dataOf(await request.post(`/api/records/orders/${orderId}/submit`, { headers: headers(laboratory.token), data: { remarks: 'Complete synthetic report' } }), 'submit result');
  await dataOf(await request.post(`/api/records/orders/${orderId}/approval`, { headers: headers(supervisor.token), data: { decision: 'approve', remarks: 'E2E supervisor approval' } }), 'approve result');

  await expect.poll(async () => {
    const state = await dataOf(await request.get(`/api/records/orders/${orderId}`, { headers: headers(supervisor.token) }), 'poll publication');
    return state.order?.status || state.status;
  }, { timeout: 30_000 }).toMatch(/LEDGER_REGISTERED|REGISTERED|RELEASED/);

  const release = await dataOf(await request.post(`/api/records/orders/${orderId}/release`, { headers: headers(supervisor.token), data: { remarks: 'Release synthetic report' } }), 'release result');
  const verificationToken = release.verificationToken || release.release?.verificationToken;
  expect(verificationToken).toBeTruthy();

  await dataOf(await request.post(`/api/records/orders/${orderId}/doctor-review`, { headers: headers(doctor.token), data: { acknowledgment: true, interpretation: 'Reviewed synthetic CBC.', followUpPlan: 'Synthetic follow-up only.' } }), 'doctor review');
  const own = await dataOf(await request.get('/api/records/me/results', { headers: headers(patientAccount.token) }), 'patient own results');
  expect(JSON.stringify(own)).toContain(orderId);

  const publicResult = await dataOf(await request.get(`/api/verification/public/${verificationToken}`), 'public verification');
  const serialized = JSON.stringify(publicResult).toLowerCase();
  expect(serialized).toContain('valid');
  for (const forbidden of ['synthetic patient', 'test address', 'hemoglobin', 'clinicalnotes', 'cid', 'ipfs']) expect(serialized).not.toContain(forbidden);
  for (const forbiddenField of ['patientName', 'patientCode', 'address', 'results', 'laboratoryValues', 'cid', 'token']) expect(publicResult[forbiddenField]).toBeUndefined();
});
