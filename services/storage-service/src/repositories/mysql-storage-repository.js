import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

function mapVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    recordId: row.record_id,
    version: Number(row.record_version),
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    objectReference: row.object_reference,
    objectProvider: row.object_provider,
    envelopeHash: row.envelope_hash,
    sizeBytes: Number(row.size_bytes),
    algorithm: row.algorithm,
    keyReference: row.key_reference,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class MysqlStorageRepository {
  constructor(config) {
    this.pool = mysql.createPool({ ...config, waitForConnections: true, timezone: 'Z', decimalNumbers: true });
    this.provider = 'mysql';
    this.simulated = false;
  }

  async init() {
    await this.pool.query('SELECT 1');
  }

  async findByIdempotencyKey(key) {
    const [rows] = await this.pool.execute('SELECT * FROM encrypted_object_versions WHERE idempotency_key = ? LIMIT 1', [key]);
    return mapVersion(rows[0]);
  }

  async findVersion(recordId, version) {
    const [rows] = await this.pool.execute('SELECT * FROM encrypted_object_versions WHERE record_id = ? AND record_version = ? LIMIT 1', [recordId, version]);
    return mapVersion(rows[0]);
  }

  async commitPackage(metadata) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [keyRows] = await connection.execute('SELECT * FROM encrypted_object_versions WHERE idempotency_key = ? FOR UPDATE', [metadata.idempotencyKey]);
      if (keyRows[0]) {
        await connection.rollback();
        const value = mapVersion(keyRows[0]);
        return { outcome: value.requestFingerprint === metadata.requestFingerprint ? 'duplicate' : 'idempotency-conflict', value };
      }
      const [versionRows] = await connection.execute('SELECT * FROM encrypted_object_versions WHERE record_id = ? AND record_version = ? FOR UPDATE', [metadata.recordId, metadata.version]);
      if (versionRows[0]) {
        await connection.rollback();
        const value = mapVersion(versionRows[0]);
        return { outcome: value.requestFingerprint === metadata.requestFingerprint ? 'duplicate' : 'version-conflict', value };
      }
      await connection.execute(
        'INSERT INTO encrypted_objects (id, record_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)',
        [randomUUID(), metadata.recordId, metadata.createdAt, metadata.createdAt],
      );
      const id = randomUUID();
      await connection.execute(
        `INSERT INTO encrypted_object_versions
          (id, record_id, record_version, idempotency_key, request_fingerprint, object_reference, object_provider, envelope_hash, size_bytes, algorithm, key_reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, metadata.recordId, metadata.version, metadata.idempotencyKey, metadata.requestFingerprint, metadata.objectReference, metadata.objectProvider, metadata.envelopeHash, metadata.sizeBytes, metadata.algorithm, metadata.keyReference, metadata.createdAt],
      );
      const jobId = randomUUID();
      await connection.execute(
        `INSERT INTO storage_jobs (id, job_type, record_id, record_version, status, attempts, created_at, completed_at)
         VALUES (?, 'PACKAGE_CREATE', ?, ?, 'SUCCEEDED', 1, ?, ?)`,
        [jobId, metadata.recordId, metadata.version, metadata.createdAt, metadata.createdAt],
      );
      await connection.execute(
        'INSERT INTO storage_receipts (id, job_id, encrypted_object_version_id, envelope_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        [randomUUID(), jobId, id, metadata.envelopeHash, metadata.createdAt],
      );
      await connection.execute(
        'INSERT IGNORE INTO encryption_key_references (id, key_reference, algorithm, created_at) VALUES (?, ?, ?, ?)',
        [randomUUID(), metadata.keyReference, 'AES-256-GCM', metadata.createdAt],
      );
      await connection.commit();
      return { outcome: 'created', value: { ...metadata, id } };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async recordRetrieval(entry) {
    await this.pool.execute(
      `INSERT INTO retrieval_audit (id, record_id, record_version, caller_service, request_id, outcome, failure_code, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), entry.recordId, entry.version, entry.callerService, entry.requestId, entry.outcome, entry.failureCode || null, entry.occurredAt],
    );
  }

  async listJobs({ limit = 50, status } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const [rows] = status
      ? await this.pool.execute(`SELECT * FROM storage_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ${safeLimit}`, [status])
      : await this.pool.query(`SELECT * FROM storage_jobs ORDER BY created_at DESC LIMIT ${safeLimit}`);
    return rows.map((row) => ({
      id: row.id,
      type: row.job_type,
      recordId: row.record_id,
      version: Number(row.record_version),
      status: row.status,
      attempts: Number(row.attempts),
      createdAt: new Date(row.created_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    }));
  }

  async health() {
    try {
      await this.pool.query('SELECT 1');
      return { ok: true, provider: this.provider, simulated: false };
    } catch {
      return { ok: false, provider: this.provider, simulated: false };
    }
  }

  async close() {
    await this.pool.end();
  }
}
