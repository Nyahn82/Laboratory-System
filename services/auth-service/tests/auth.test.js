import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ROLE_BY_CODE, USER_STATUSES } from '../src/constants.js';
import { hashPassword } from '../src/security.js';
import { FileAuthStore } from '../src/stores/file-auth-store.js';
import { MemoryAuthStore } from '../src/stores/memory-auth-store.js';

const ADMIN_PASSWORD = 'AdminPassword!123';
const DOCTOR_PASSWORD = 'DoctorPassword!123';
const FORCED_PASSWORD = 'TemporaryPassword!123';

const quietLogger = { info() {}, error() {} };

function extractRefreshToken(response) {
  const cookies = response.headers['set-cookie'] ?? [];
  const match = cookies.find((cookie) => cookie.startsWith('refresh_token='))?.match(/^refresh_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function buildFixture() {
  const users = [
    {
      id: 'admin-user',
      email: 'admin@example.test',
      passwordHash: await hashPassword(ADMIN_PASSWORD, 4),
      firstName: 'System',
      lastName: 'Administrator',
      status: USER_STATUSES.ACTIVE,
      mustChangePassword: false,
      roleCodes: ['SYSTEM_ADMIN'],
    },
    {
      id: 'doctor-user',
      email: 'doctor@example.test',
      passwordHash: await hashPassword(DOCTOR_PASSWORD, 4),
      firstName: 'Demo',
      lastName: 'Doctor',
      status: USER_STATUSES.ACTIVE,
      mustChangePassword: false,
      roleCodes: ['DOCTOR'],
    },
    {
      id: 'forced-admin-user',
      email: 'forced-admin@example.test',
      passwordHash: await hashPassword(FORCED_PASSWORD, 4),
      firstName: 'Forced',
      lastName: 'Administrator',
      status: USER_STATUSES.ACTIVE,
      mustChangePassword: true,
      roleCodes: ['SYSTEM_ADMIN'],
    },
  ];
  let idSequence = 0;
  let tokenSequence = 0;
  const idFactory = () => `test-id-${String(++idSequence).padStart(6, '0')}`;
  const tokenFactory = () => `test-refresh-token-${String(++tokenSequence).padStart(64, '0')}`;
  const store = new MemoryAuthStore({ users });
  const config = {
    nodeEnv: 'test',
    storeKind: 'memory',
    jwtAccessSecret: 'test-access-secret-that-is-at-least-32-characters-long',
    jwtIssuer: 'test-auth-service',
    jwtAudience: 'test-lab-platform',
    jwtAccessTtlSeconds: 300,
    refreshTokenTtlSeconds: 3600,
    passwordResetTtlSeconds: 600,
    bcryptRounds: 4,
    cookieName: 'refresh_token',
    cookieSecure: false,
    trustProxy: false,
    rateLimitEnabled: false,
    exposeResetToken: true,
  };
  const app = createApp({ store, config, logger: quietLogger, idFactory, tokenFactory });
  return { app, store, config };
}

describe('authentication service', () => {
  let fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('restricts account trails to administrators and includes actor and target events with pagination', async () => {
    const admin = await request(fixture.app).post('/login').send({ email: 'admin@example.test', password: ADMIN_PASSWORD });
    const doctor = await request(fixture.app).post('/login').send({ email: 'doctor@example.test', password: DOCTOR_PASSWORD });
    const forced = await request(fixture.app).post('/login').send({ email: 'forced-admin@example.test', password: FORCED_PASSWORD });
    await request(fixture.app).get('/users/doctor-user/audit').expect(401);
    await request(fixture.app).get('/users/doctor-user/audit').auth(doctor.body.data.accessToken, { type: 'bearer' }).expect(403);
    await request(fixture.app).get('/users/doctor-user/audit').auth(forced.body.data.accessToken, { type: 'bearer' }).expect(403);
    await request(fixture.app).patch('/users/doctor-user/status').auth(admin.body.data.accessToken, { type: 'bearer' }).send({ status: 'DISABLED' }).expect(200);
    const result = await request(fixture.app).get('/users/doctor-user/audit?limit=1&offset=0').auth(admin.body.data.accessToken, { type: 'bearer' }).expect(200);
    expect(result.body.data.pagination.total).toBe(2);
    expect(result.body.data.items[0]).toMatchObject({ eventType: 'USER_STATUS_CHANGE', actorUserId: 'admin-user', targetId: 'doctor-user' });
    expect(result.body.data.items[0]).not.toHaveProperty('metadata');
    const second = await request(fixture.app).get('/users/doctor-user/audit?limit=1&offset=1').auth(admin.body.data.accessToken, { type: 'bearer' }).expect(200);
    expect(second.body.data.items[0]).toMatchObject({ eventType: 'AUTH_LOGIN', actorUserId: 'doctor-user' });
    await request(fixture.app).get('/users/missing/audit').auth(admin.body.data.accessToken, { type: 'bearer' }).expect(404);
    await request(fixture.app).get('/users/doctor-user/audit?limit=500').auth(admin.body.data.accessToken, { type: 'bearer' }).expect(400);
  });

  it('logs in with a short-lived JWT containing the required authorization claims', async () => {
    const response = await request(fixture.app)
      .post('/login')
      .send({ email: 'ADMIN@example.test', password: ADMIN_PASSWORD })
      .expect(200);

    expect(response.body).toMatchObject({ success: true, message: 'Login successful', errors: [] });
    expect(response.body.data).not.toHaveProperty('refreshToken');
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    expect(extractRefreshToken(response)).toMatch(/^test-refresh-token-/);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');

    const claims = jwt.verify(response.body.data.accessToken, fixture.config.jwtAccessSecret, {
      issuer: fixture.config.jwtIssuer,
      audience: fixture.config.jwtAudience,
    });
    expect(claims).toMatchObject({
      sub: 'admin-user',
      email: 'admin@example.test',
      roles: ['SYSTEM_ADMIN'],
      permissions: ROLE_BY_CODE.SYSTEM_ADMIN.permissions.slice().sort(),
      patientId: null,
      mustChangePassword: false,
    });
  });

  it('rotates refresh tokens and rejects reuse by revoking the token family', async () => {
    const login = await request(fixture.app)
      .post('/login')
      .send({ email: 'admin@example.test', password: ADMIN_PASSWORD })
      .expect(200);
    const originalToken = extractRefreshToken(login);

    const refresh = await request(fixture.app)
      .post('/refresh')
      .send({ refreshToken: originalToken })
      .expect(200);
    const replacementToken = extractRefreshToken(refresh);
    expect(replacementToken).not.toBe(originalToken);

    const reuse = await request(fixture.app)
      .post('/refresh')
      .send({ refreshToken: originalToken })
      .expect(401);
    expect(reuse.body.errors[0].code).toBe('REFRESH_TOKEN_REUSED');

    const revokedReplacement = await request(fixture.app)
      .post('/refresh')
      .send({ refreshToken: replacementToken })
      .expect(401);
    expect(revokedReplacement.body.errors[0].code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('allows only me, password change, and logout until a forced password change is complete', async () => {
    const login = await request(fixture.app)
      .post('/login')
      .send({ email: 'forced-admin@example.test', password: FORCED_PASSWORD })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;

    await request(fixture.app).get('/me').set('authorization', authorization).expect(200);
    const blocked = await request(fixture.app).get('/roles').set('authorization', authorization).expect(403);
    expect(blocked.body.errors[0].code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await request(fixture.app)
      .post('/password/change')
      .set('authorization', authorization)
      .send({ currentPassword: FORCED_PASSWORD, newPassword: 'ChangedPassword!456' })
      .expect(200);
    expect(changed.body.data.accessToken).toEqual(expect.any(String));
    expect(changed.body.data.user.mustChangePassword).toBe(false);

    const roles = await request(fixture.app).get('/roles').set('authorization', `Bearer ${changed.body.data.accessToken}`).expect(200);
    expect(roles.body.data.items.map((role) => role.code).sort()).toEqual(
      Object.keys(ROLE_BY_CODE).sort(),
    );
  });

  it('prevents a doctor from using system-administrator user endpoints', async () => {
    const login = await request(fixture.app)
      .post('/login')
      .send({ email: 'doctor@example.test', password: DOCTOR_PASSWORD })
      .expect(200);
    const response = await request(fixture.app)
      .get('/users')
      .set('authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(403);
    expect(response.body.errors[0].code).toBe('FORBIDDEN');
  });

  it('reports liveness and store readiness with the uniform envelope', async () => {
    const health = await request(fixture.app).get('/health').expect(200);
    expect(health.body).toMatchObject({ success: true, data: { status: 'healthy' }, errors: [] });

    const ready = await request(fixture.app).get('/ready').expect(200);
    expect(ready.body).toMatchObject({ success: true, data: { status: 'ready' }, errors: [] });
    expect(ready.body.data.dependencies.store).toMatchObject({ driver: 'memory', simulated: true });
  });

  it('keeps gateway prefixes outside the service-local route table', async () => {
    await request(fixture.app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.test', password: ADMIN_PASSWORD })
      .expect(404);
  });
});

describe('file authentication store', () => {
  const temporaryDirectories = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('atomically persists state and reports the adapter as simulated', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'rhu-auth-store-'));
    temporaryDirectories.push(dataRoot);
    const filename = path.join(dataRoot, 'auth', 'auth.json');
    const passwordHash = await hashPassword(ADMIN_PASSWORD, 4);
    const store = new FileAuthStore({ filename });

    await store.createUser({
      id: 'persistent-admin',
      email: 'persistent@example.test',
      passwordHash,
      firstName: 'Persistent',
      lastName: 'Administrator',
      patientId: null,
      status: USER_STATUSES.ACTIVE,
      mustChangePassword: false,
      roleCodes: ['SYSTEM_ADMIN'],
      passwordChangedAt: null,
    });
    await store.createSession({
      id: 'persistent-session',
      familyId: 'persistent-family',
      userId: 'persistent-admin',
      tokenHash: 'a'.repeat(64),
      userAgent: null,
      ipAddress: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      createdAt: new Date().toISOString(),
    });
    expect(await store.healthCheck()).toMatchObject({
      ok: true,
      driver: 'file',
      provider: 'atomic-json',
      simulated: true,
      filePath: filename,
    });
    await store.close();

    const state = JSON.parse(await readFile(filename, 'utf8'));
    expect(state).toMatchObject({ schemaVersion: 1 });
    expect(state.users).toHaveLength(1);
    expect(await readdir(path.dirname(filename))).toEqual(['auth.json']);

    const reopened = new FileAuthStore({ filename });
    expect(await reopened.findUserByEmail('PERSISTENT@example.test')).toMatchObject({
      id: 'persistent-admin',
      roles: ['SYSTEM_ADMIN'],
    });
    expect(await reopened.findSessionByTokenHash('a'.repeat(64))).toMatchObject({ id: 'persistent-session' });

    const { config } = await buildFixture();
    const app = createApp({
      store: reopened,
      config: { ...config, dbDriver: 'file', storeKind: 'file', authDataFile: filename },
      logger: quietLogger,
    });
    const ready = await request(app).get('/ready').expect(200);
    expect(ready.body.data.dependencies.store).toMatchObject({
      status: 'ready',
      driver: 'file',
      provider: 'atomic-json',
      simulated: true,
    });
    await reopened.close();
  });
});
