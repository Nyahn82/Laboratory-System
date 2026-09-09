import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

function parseJson(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function mapOperation(row) {
  return row ? { idempotencyKey: row.idempotency_key, fingerprint: row.request_fingerprint, operationType: row.operation_type, response: parseJson(row.response_json) } : null;
}

function mapRegistration(row) {
  if (!row) return null;
  return {
    id: row.id,
    recordId: row.record_id,
    version: Number(row.record_version),
    documentHash: row.document_hash,
    encryptedCidReference: row.encrypted_cid_reference,
    approvalTimestamp: new Date(row.approval_timestamp).toISOString(),
    issuingOrganization: row.issuing_organization,
    status: row.status,
    registrationTransactionId: row.registration_transaction_id,
    releaseTransactionId: row.release_transaction_id,
    releaseTimestamp: row.release_timestamp ? new Date(row.release_timestamp).toISOString() : null,
    revokeTransactionId: row.revoke_transaction_id,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    reasonCode: row.reason_code,
    registeredAt: new Date(row.registered_at).toISOString(),
  };
}

function sameProof(left, right) {
  return left.documentHash === right.documentHash
    && (left.encryptedCidReference || null) === (right.encryptedCidReference || null)
    && left.approvalTimestamp === right.approvalTimestamp
    && left.issuingOrganization === right.issuingOrganization;
}

export class MysqlVerificationRepository {
  constructor(config) {
    this.pool = mysql.createPool({ ...config, waitForConnections: true, timezone: 'Z', decimalNumbers: true });
    this.provider = 'mysql';
    this.simulated = false;
  }

  async init() { await this.pool.query('SELECT 1'); }

  async findOperation(key) {
    const [rows] = await this.pool.execute('SELECT * FROM verification_idempotency WHERE idempotency_key = ? LIMIT 1', [key]);
    return mapOperation(rows[0]);
  }

  async getRegistration(recordId, version) {
    const [rows] = await this.pool.execute('SELECT * FROM ledger_registrations WHERE record_id = ? AND record_version = ? LIMIT 1', [recordId, version]);
    return mapRegistration(rows[0]);
  }

  async getLatestRegistration(recordId) {
    const [rows] = await this.pool.execute('SELECT * FROM ledger_registrations WHERE record_id = ? ORDER BY record_version DESC LIMIT 1', [recordId]);
    return mapRegistration(rows[0]);
  }

  async #existingOperation(connection, operation) {
    const [rows] = await connection.execute('SELECT * FROM verification_idempotency WHERE idempotency_key = ? FOR UPDATE', [operation.idempotencyKey]);
    if (!rows[0]) return null;
    const prior = mapOperation(rows[0]);
    return { outcome: prior.fingerprint === operation.fingerprint ? 'duplicate' : 'idempotency-conflict', operation: prior };
  }

  async #insertOperation(connection, operation, timestamp) {
    await connection.execute(
      'INSERT INTO verification_idempotency (id, idempotency_key, request_fingerprint, operation_type, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), operation.idempotencyKey, operation.fingerprint, operation.operationType, JSON.stringify(operation.response), timestamp],
    );
  }

  async #insertTransaction(connection, transaction) {
    await connection.execute(
      `INSERT INTO ledger_transactions (id, record_id, record_version, operation_type, fabric_transaction_id, ledger_provider, simulated, committed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), transaction.recordId, transaction.version, transaction.operationType, transaction.transactionId, transaction.ledgerProvider, transaction.simulated, transaction.committedAt],
    );
  }

  async #insertJob(connection, type, recordId, version, timestamp) {
    await connection.execute(
      `INSERT INTO ledger_registration_jobs (id, job_type, record_id, record_version, status, attempts, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'SUCCEEDED', 1, ?, ?)`,
      [randomUUID(), type, recordId, version, timestamp, timestamp],
    );
  }

  async commitRegistration({ operation, registration, transaction }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const priorOperation = await this.#existingOperation(connection, operation);
      if (priorOperation) { await connection.rollback(); return priorOperation; }
      const [rows] = await connection.execute('SELECT * FROM ledger_registrations WHERE record_id = ? AND record_version = ? FOR UPDATE', [registration.recordId, registration.version]);
      if (rows[0]) {
        await connection.rollback();
        const prior = mapRegistration(rows[0]);
        return { outcome: sameProof(prior, registration) ? 'version-duplicate' : 'version-conflict', registration: prior };
      }
      await connection.execute(
        `INSERT INTO ledger_registrations
          (id, record_id, record_version, document_hash, encrypted_cid_reference, approval_timestamp, issuing_organization, status, registration_transaction_id, registered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'REGISTERED', ?, ?)`,
        [randomUUID(), registration.recordId, registration.version, registration.documentHash, registration.encryptedCidReference || null, registration.approvalTimestamp, registration.issuingOrganization, registration.registrationTransactionId, registration.registeredAt],
      );
      await this.#insertOperation(connection, operation, registration.registeredAt);
      await this.#insertTransaction(connection, transaction);
      await this.#insertJob(connection, 'REGISTER', registration.recordId, registration.version, registration.registeredAt);
      await connection.commit();
      return { outcome: 'created', registration };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally { connection.release(); }
  }

  async commitRelease({ operation, recordId, version, releaseTimestamp, transaction, token }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const priorOperation = await this.#existingOperation(connection, operation);
      if (priorOperation) { await connection.rollback(); return priorOperation; }
      const [rows] = await connection.execute('SELECT * FROM ledger_registrations WHERE record_id = ? AND record_version = ? FOR UPDATE', [recordId, version]);
      const registration = mapRegistration(rows[0]);
      if (!registration) { await connection.rollback(); return { outcome: 'not-found' }; }
      if (registration.status === 'REVOKED') { await connection.rollback(); return { outcome: 'revoked' }; }
      if (registration.status === 'RELEASED') { await connection.rollback(); return { outcome: 'already-released', registration }; }
      await connection.execute(
        `UPDATE ledger_registrations SET status = 'RELEASED', release_timestamp = ?, release_transaction_id = ? WHERE record_id = ? AND record_version = ?`,
        [releaseTimestamp, transaction.transactionId, recordId, version],
      );
      await connection.execute(
        `INSERT INTO verification_tokens (id, token_digest, record_id, record_version, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        [randomUUID(), token.tokenDigest, recordId, version, token.createdAt, token.expiresAt],
      );
      await this.#insertOperation(connection, operation, releaseTimestamp);
      await this.#insertTransaction(connection, transaction);
      await this.#insertJob(connection, 'RELEASE', recordId, version, releaseTimestamp);
      await connection.commit();
      return { outcome: 'released', registration: { ...registration, status: 'RELEASED', releaseTimestamp, releaseTransactionId: transaction.transactionId } };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally { connection.release(); }
  }

  async commitRevoke({ operation, recordId, version, reasonCode, revokedAt, transaction }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const priorOperation = await this.#existingOperation(connection, operation);
      if (priorOperation) { await connection.rollback(); return priorOperation; }
      const [rows] = await connection.execute('SELECT * FROM ledger_registrations WHERE record_id = ? AND record_version = ? FOR UPDATE', [recordId, version]);
      const registration = mapRegistration(rows[0]);
      if (!registration) { await connection.rollback(); return { outcome: 'not-found' }; }
      if (registration.status === 'REVOKED') { await connection.rollback(); return { outcome: 'already-revoked', registration }; }
      await connection.execute(
        `UPDATE ledger_registrations SET status = 'REVOKED', reason_code = ?, revoked_at = ?, revoke_transaction_id = ? WHERE record_id = ? AND record_version = ?`,
        [reasonCode, revokedAt, transaction.transactionId, recordId, version],
      );
      await connection.execute(
        `UPDATE verification_tokens SET status = 'REVOKED', revoked_at = ? WHERE record_id = ? AND record_version = ? AND status = 'ACTIVE'`,
        [revokedAt, recordId, version],
      );
      await this.#insertOperation(connection, operation, revokedAt);
      await this.#insertTransaction(connection, transaction);
      await this.#insertJob(connection, 'REVOKE', recordId, version, revokedAt);
      await connection.commit();
      return { outcome: 'revoked', registration: { ...registration, status: 'REVOKED', reasonCode, revokedAt } };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally { connection.release(); }
  }

  async findToken(tokenDigest) {
    const [rows] = await this.pool.execute('SELECT * FROM verification_tokens WHERE token_digest = ? LIMIT 1', [tokenDigest]);
    const row = rows[0];
    return row ? {
      id: row.id,
      tokenDigest: row.token_digest,
      recordId: row.record_id,
      version: Number(row.record_version),
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    } : null;
  }

  async recordVerification(entry) {
    await this.pool.execute(
      `INSERT INTO verification_receipts (id, token_id, record_id, record_version, outcome, request_id, source, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), entry.tokenId || null, entry.recordId || null, entry.version || null, entry.outcome, entry.requestId, entry.source, entry.occurredAt],
    );
  }

  async listJobs({ limit = 50, status } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const [rows] = status
      ? await this.pool.execute(`SELECT * FROM ledger_registration_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ${safeLimit}`, [status])
      : await this.pool.query(`SELECT * FROM ledger_registration_jobs ORDER BY created_at DESC LIMIT ${safeLimit}`);
    return rows.map((row) => ({ id: row.id, type: row.job_type, recordId: row.record_id, version: Number(row.record_version), status: row.status, attempts: Number(row.attempts), createdAt: new Date(row.created_at).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null }));
  }

  async health() {
    try { await this.pool.query('SELECT 1'); return { ok: true, provider: this.provider, simulated: false }; }
    catch { return { ok: false, provider: this.provider, simulated: false }; }
  }

  async close() { await this.pool.end(); }
}
