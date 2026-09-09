import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { ROLE_DEFINITIONS, USER_STATUSES } from '../src/constants.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/security.js';
import { FileAuthStore } from '../src/stores/file-auth-store.js';
import { strongPassword } from '../src/validation.js';

const password = process.env.DEV_SEED_PASSWORD;
if (!password) throw new Error('DEV_SEED_PASSWORD is required; no seed password is embedded in source code');
const passwordResult = strongPassword.safeParse(password);
if (!passwordResult.success) throw new Error('DEV_SEED_PASSWORD does not satisfy the service password policy');
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
  throw new Error('Development seed is disabled in production');
}

const emailDomain = (process.env.DEV_SEED_EMAIL_DOMAIN ?? 'lab.local').trim().toLowerCase();
if (!/^[a-z0-9.-]+$/.test(emailDomain)) throw new Error('DEV_SEED_EMAIL_DOMAIN is invalid');

const seedUsers = [
  ['admin', 'System', 'Administrator', 'SYSTEM_ADMIN', null],
  ['cashier', 'Registration', 'Cashier', 'REGISTRATION_CASHIER', null],
  ['doctor', 'Demo', 'Doctor', 'DOCTOR', null],
  ['labstaff', 'Laboratory', 'Technologist', 'LAB_STAFF', null],
  ['supervisor', 'Laboratory', 'Supervisor', 'LAB_SUPERVISOR', null],
  ['patient', 'Demo', 'Patient', 'PATIENT', 'PATIENT-DEMO-001'],
  ['verifier', 'Public', 'Verifier', 'PUBLIC_VERIFIER', null],
];

const config = loadConfig();
const passwordHash = await hashPassword(password, config.bcryptRounds);

async function seedFileStore() {
  const store = new FileAuthStore({ filename: config.authDataFile });
  try {
    for (const [localPart, firstName, lastName, roleCode, patientId] of seedUsers) {
      const email = `${localPart}@${emailDomain}`;
      const existing = await store.findUserByEmail(email);
      if (existing) {
        await store.updateUser(existing.id, {
          firstName,
          lastName,
          patientId,
          mustChangePassword: true,
          roleCodes: [roleCode],
        });
        await store.setUserStatus(existing.id, USER_STATUSES.ACTIVE);
        await store.updatePassword(existing.id, passwordHash, { mustChangePassword: true });
      } else {
        await store.createUser({
          id: crypto.randomUUID(),
          email,
          passwordHash,
          firstName,
          lastName,
          patientId,
          status: USER_STATUSES.ACTIVE,
          mustChangePassword: true,
          roleCodes: [roleCode],
          passwordChangedAt: null,
        });
      }
    }
  } finally {
    await store.close();
  }
}

async function seedMySqlStore() {
  const connection = await mysql.createConnection({ ...config.database, timezone: 'Z', charset: 'utf8mb4' });
  try {
    await connection.beginTransaction();
    for (const role of ROLE_DEFINITIONS) {
      await connection.execute(
        `INSERT INTO roles (id, code, name, description, permissions)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description),
                                 permissions = VALUES(permissions), updated_at = CURRENT_TIMESTAMP(3)`,
        [crypto.randomUUID(), role.code, role.name, role.description, JSON.stringify(role.permissions)],
      );
    }

    for (const [localPart, firstName, lastName, roleCode, patientId] of seedUsers) {
      const email = `${localPart}@${emailDomain}`;
      const [existingUsers] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
      const userId = existingUsers[0]?.id ?? crypto.randomUUID();
      await connection.execute(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, patient_id, status, must_change_password
         ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), first_name = VALUES(first_name),
                                 last_name = VALUES(last_name), patient_id = VALUES(patient_id),
                                 status = VALUES(status), must_change_password = TRUE,
                                 updated_at = CURRENT_TIMESTAMP(3)`,
        [userId, email, passwordHash, firstName, lastName, patientId, USER_STATUSES.ACTIVE],
      );
      const [roleRows] = await connection.execute('SELECT id FROM roles WHERE code = ? LIMIT 1', [roleCode]);
      await connection.execute('DELETE FROM user_roles WHERE user_id = ?', [userId]);
      await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleRows[0].id]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

if (config.dbDriver === 'file') await seedFileStore();
else await seedMySqlStore();
console.log(`seeded ${seedUsers.length} development users across ${ROLE_DEFINITIONS.length} roles using ${config.dbDriver}`);
