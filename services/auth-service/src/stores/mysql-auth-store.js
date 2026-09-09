import mysql from 'mysql2/promise';
import { StoreConflictError, StoreValidationError } from '../errors.js';

function asIso(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parsePermissions(value) {
  if (Array.isArray(value)) return value;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

function mapUserRow(row, roleRecords = []) {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    firstName: row.first_name,
    lastName: row.last_name,
    patientId: row.patient_id ?? null,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    passwordChangedAt: asIso(row.password_changed_at),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    roles: roleRecords.map((role) => role.code).sort(),
    permissions: [...new Set(roleRecords.flatMap((role) => role.permissions))].sort(),
  };
}

function mapSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    familyId: row.family_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    expiresAt: asIso(row.expires_at),
    lastUsedAt: asIso(row.last_used_at),
    revokedAt: asIso(row.revoked_at),
    revocationReason: row.revocation_reason,
    replacedBySessionId: row.replaced_by_session_id,
    createdAt: asIso(row.created_at),
  };
}

export class MySqlAuthStore {
  constructor(databaseConfig, { pool } = {}) {
    this.pool = pool ?? mysql.createPool({
      ...databaseConfig,
      waitForConnections: true,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: 'Z',
      namedPlaceholders: false,
    });
  }

  async healthCheck() {
    await this.pool.query('SELECT 1');
    return { ok: true, driver: 'mysql', provider: 'mysql', simulated: false };
  }

  async close() {
    await this.pool.end();
  }

  async loadRolesByUserIds(userIds, connection = this.pool) {
    if (userIds.length === 0) return new Map();
    const placeholders = userIds.map(() => '?').join(', ');
    const [rows] = await connection.query(
      `SELECT ur.user_id, r.code, r.permissions
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id IN (${placeholders})
        ORDER BY r.code`,
      userIds,
    );
    const roles = new Map(userIds.map((id) => [id, []]));
    for (const row of rows) {
      roles.get(row.user_id)?.push({ code: row.code, permissions: parsePermissions(row.permissions) });
    }
    return roles;
  }

  async findUser(whereClause, value) {
    const [rows] = await this.pool.execute(
      `SELECT id, email, password_hash, first_name, last_name, patient_id, status,
              must_change_password, password_changed_at, created_at, updated_at
         FROM users WHERE ${whereClause} = ? LIMIT 1`,
      [value],
    );
    if (rows.length === 0) return null;
    const roleMap = await this.loadRolesByUserIds([rows[0].id]);
    return mapUserRow(rows[0], roleMap.get(rows[0].id));
  }

  async findUserByEmail(email) {
    return this.findUser('email', email.trim().toLowerCase());
  }

  async findUserById(id) {
    return this.findUser('id', id);
  }

  async listUsers({ limit = 25, offset = 0, status, role } = {}) {
    const clauses = [];
    const parameters = [];
    if (status) {
      clauses.push('u.status = ?');
      parameters.push(status);
    }
    if (role) {
      clauses.push(`EXISTS (
        SELECT 1 FROM user_roles filter_ur
        JOIN roles filter_r ON filter_r.id = filter_ur.role_id
        WHERE filter_ur.user_id = u.id AND filter_r.code = ?
      )`);
      parameters.push(role);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const [countRows] = await this.pool.query(`SELECT COUNT(*) AS total FROM users u ${where}`, parameters);
    const [rows] = await this.pool.query(
      `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.patient_id,
              u.status, u.must_change_password, u.password_changed_at, u.created_at, u.updated_at
         FROM users u ${where}
        ORDER BY u.email, u.id LIMIT ? OFFSET ?`,
      [...parameters, limit, offset],
    );
    const roleMap = await this.loadRolesByUserIds(rows.map((row) => row.id));
    return {
      users: rows.map((row) => mapUserRow(row, roleMap.get(row.id))),
      total: Number(countRows[0].total),
    };
  }

  async resolveRoleIds(roleCodes, connection) {
    if (roleCodes.length === 0) throw new StoreValidationError('At least one role is required');
    const placeholders = roleCodes.map(() => '?').join(', ');
    const [rows] = await connection.query(
      `SELECT id, code FROM roles WHERE code IN (${placeholders})`,
      roleCodes,
    );
    if (rows.length !== new Set(roleCodes).size) {
      const known = new Set(rows.map((row) => row.code));
      const unknown = roleCodes.filter((code) => !known.has(code));
      throw new StoreValidationError(`Unknown role code: ${unknown.join(', ')}`);
    }
    return new Map(rows.map((row) => [row.code, row.id]));
  }

  async replaceUserRoles(userId, roleCodes, connection) {
    const roleIds = await this.resolveRoleIds(roleCodes, connection);
    await connection.execute('DELETE FROM user_roles WHERE user_id = ?', [userId]);
    for (const roleCode of [...new Set(roleCodes)]) {
      await connection.execute(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [userId, roleIds.get(roleCode)],
      );
    }
  }

  async createUser(input) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO users (
          id, email, password_hash, first_name, last_name, patient_id, status,
          must_change_password, password_changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.email.trim().toLowerCase(),
          input.passwordHash,
          input.firstName,
          input.lastName,
          input.patientId ?? null,
          input.status,
          input.mustChangePassword ? 1 : 0,
          input.passwordChangedAt ?? null,
        ],
      );
      await this.replaceUserRoles(input.id, input.roleCodes, connection);
      await connection.commit();
      return this.findUserById(input.id);
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        throw new StoreConflictError('A user with this email address already exists');
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateUser(id, updates) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
      if (existing.length === 0) {
        await connection.rollback();
        return null;
      }
      const columns = [];
      const values = [];
      const fieldMap = {
        email: 'email',
        firstName: 'first_name',
        lastName: 'last_name',
        patientId: 'patient_id',
        mustChangePassword: 'must_change_password',
      };
      for (const [field, column] of Object.entries(fieldMap)) {
        if (updates[field] !== undefined) {
          columns.push(`${column} = ?`);
          let value = updates[field];
          if (field === 'email') value = value.trim().toLowerCase();
          if (field === 'mustChangePassword') value = value ? 1 : 0;
          values.push(value);
        }
      }
      if (columns.length > 0) {
        columns.push('updated_at = CURRENT_TIMESTAMP(3)');
        await connection.query(`UPDATE users SET ${columns.join(', ')} WHERE id = ?`, [...values, id]);
      }
      if (updates.roleCodes !== undefined) await this.replaceUserRoles(id, updates.roleCodes, connection);
      await connection.commit();
      return this.findUserById(id);
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        throw new StoreConflictError('A user with this email address already exists');
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async setUserStatus(id, status) {
    const [result] = await this.pool.execute(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [status, id],
    );
    return result.affectedRows === 0 ? null : this.findUserById(id);
  }

  async updatePassword(id, passwordHash, { mustChangePassword = false, changedAt = new Date() } = {}) {
    const [result] = await this.pool.execute(
      `UPDATE users SET password_hash = ?, must_change_password = ?, password_changed_at = ?,
                        updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
      [passwordHash, mustChangePassword ? 1 : 0, changedAt, id],
    );
    return result.affectedRows === 0 ? null : this.findUserById(id);
  }

  async listRoles() {
    const [rows] = await this.pool.query(
      'SELECT id, code, name, description, permissions FROM roles ORDER BY code',
    );
    return rows.map((row) => ({ ...row, permissions: parsePermissions(row.permissions) }));
  }

  async createSession(session, connection = this.pool) {
    await connection.execute(
      `INSERT INTO sessions (
        id, family_id, user_id, token_hash, user_agent, ip_address, expires_at,
        last_used_at, revoked_at, revocation_reason, replaced_by_session_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.familyId,
        session.userId,
        session.tokenHash,
        session.userAgent ?? null,
        session.ipAddress ?? null,
        session.expiresAt,
        session.lastUsedAt ?? null,
        session.revokedAt ?? null,
        session.revocationReason ?? null,
        session.replacedBySessionId ?? null,
        session.createdAt,
      ],
    );
    return session;
  }

  async findSessionByTokenHash(tokenHash) {
    const [rows] = await this.pool.execute(
      `SELECT id, family_id, user_id, token_hash, user_agent, ip_address, expires_at,
              last_used_at, revoked_at, revocation_reason, replaced_by_session_id, created_at
         FROM sessions WHERE token_hash = ? LIMIT 1`,
      [tokenHash],
    );
    return mapSessionRow(rows[0]);
  }

  async rotateSession(currentSessionId, replacement, rotatedAt = new Date()) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT id, revoked_at FROM sessions WHERE id = ? FOR UPDATE',
        [currentSessionId],
      );
      if (rows.length === 0 || rows[0].revoked_at) {
        await connection.rollback();
        return false;
      }
      await this.createSession(replacement, connection);
      await connection.execute(
        `UPDATE sessions SET revoked_at = ?, revocation_reason = 'ROTATED',
                             replaced_by_session_id = ?, last_used_at = ?
          WHERE id = ?`,
        [rotatedAt, replacement.id, rotatedAt, currentSessionId],
      );
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async revokeSessionFamily(familyId, reason, revokedAt = new Date()) {
    const [result] = await this.pool.execute(
      'UPDATE sessions SET revoked_at = ?, revocation_reason = ? WHERE family_id = ? AND revoked_at IS NULL',
      [revokedAt, reason, familyId],
    );
    return result.affectedRows;
  }

  async revokeSessionByTokenHash(tokenHash, reason, revokedAt = new Date()) {
    const [result] = await this.pool.execute(
      'UPDATE sessions SET revoked_at = ?, revocation_reason = ? WHERE token_hash = ? AND revoked_at IS NULL',
      [revokedAt, reason, tokenHash],
    );
    return result.affectedRows > 0;
  }

  async revokeAllUserSessions(userId, reason, revokedAt = new Date(), connection = this.pool) {
    const [result] = await connection.execute(
      'UPDATE sessions SET revoked_at = ?, revocation_reason = ? WHERE user_id = ? AND revoked_at IS NULL',
      [revokedAt, reason, userId],
    );
    return result.affectedRows;
  }

  async createPasswordResetToken(resetToken) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'UPDATE password_reset_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL',
        [resetToken.createdAt, resetToken.userId],
      );
      await connection.execute(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [resetToken.id, resetToken.userId, resetToken.tokenHash, resetToken.expiresAt, resetToken.createdAt],
      );
      await connection.commit();
      return resetToken;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async findPasswordResetTokenByHash(tokenHash) {
    const [rows] = await this.pool.execute(
      `SELECT id, user_id, token_hash, expires_at, consumed_at, created_at
         FROM password_reset_tokens WHERE token_hash = ? LIMIT 1`,
      [tokenHash],
    );
    if (rows.length === 0) return null;
    return {
      id: rows[0].id,
      userId: rows[0].user_id,
      tokenHash: rows[0].token_hash,
      expiresAt: asIso(rows[0].expires_at),
      consumedAt: asIso(rows[0].consumed_at),
      createdAt: asIso(rows[0].created_at),
    };
  }

  async consumePasswordResetToken({ tokenHash, passwordHash, consumedAt = new Date() }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT id, user_id, expires_at, consumed_at
           FROM password_reset_tokens WHERE token_hash = ? FOR UPDATE`,
        [tokenHash],
      );
      const token = rows[0];
      if (!token || token.consumed_at || new Date(token.expires_at) <= new Date(consumedAt)) {
        await connection.rollback();
        return false;
      }
      await connection.execute(
        'UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ?',
        [consumedAt, token.id],
      );
      await connection.execute(
        `UPDATE users SET password_hash = ?, must_change_password = 0,
                          password_changed_at = ?, updated_at = ? WHERE id = ?`,
        [passwordHash, consumedAt, consumedAt, token.user_id],
      );
      await this.revokeAllUserSessions(token.user_id, 'PASSWORD_RESET', consumedAt, connection);
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async recordLoginAttempt(attempt) {
    await this.pool.execute(
      `INSERT INTO login_attempts (
        id, email, user_id, success, failure_reason, ip_address, user_agent, attempted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attempt.id,
        attempt.email,
        attempt.userId ?? null,
        attempt.success ? 1 : 0,
        attempt.failureReason ?? null,
        attempt.ipAddress ?? null,
        attempt.userAgent ?? null,
        attempt.attemptedAt,
      ],
    );
  }

  async createAuditEvent(event) {
    await this.pool.execute(
      `INSERT INTO audit_events (
        id, actor_user_id, event_type, target_type, target_id, outcome,
        request_id, correlation_id, ip_address, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.actorUserId ?? null,
        event.eventType,
        event.targetType ?? null,
        event.targetId ?? null,
        event.outcome,
        event.requestId ?? null,
        event.correlationId ?? null,
        event.ipAddress ?? null,
        JSON.stringify(event.metadata ?? {}),
        event.createdAt,
      ],
      );
  }

  async listUserAudit(userId, { limit, offset }) {
    const where = "actor_user_id = ? OR (target_type = 'USER' AND target_id = ?)";
    const [[count]] = await this.pool.execute(`SELECT COUNT(*) AS total FROM audit_events WHERE ${where}`, [userId, userId]);
    const [rows] = await this.pool.execute(
      `SELECT id, actor_user_id, event_type, target_type, target_id, outcome, request_id, correlation_id, ip_address, created_at
       FROM audit_events WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [userId, userId, String(limit), String(offset)],
    );
    return {
      items: rows.map((row) => ({ id: row.id, actorUserId: row.actor_user_id, eventType: row.event_type,
        targetType: row.target_type, targetId: row.target_id, outcome: row.outcome, requestId: row.request_id,
        correlationId: row.correlation_id, ipAddress: row.ip_address, createdAt: asIso(row.created_at) })),
      pagination: { limit, offset, total: Number(count.total) },
    };
  }
}
