import { ROLE_DEFINITIONS, USER_STATUSES } from '../constants.js';
import { StoreConflictError, StoreValidationError } from '../errors.js';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class MemoryAuthStore {
  constructor({ users = [], roles = ROLE_DEFINITIONS, clock = () => new Date() } = {}) {
    this.clock = clock;
    this.roles = roles.map((role, index) => ({
      id: role.id ?? `role-${String(index + 1).padStart(2, '0')}`,
      code: role.code,
      name: role.name,
      description: role.description ?? null,
      permissions: [...new Set(role.permissions ?? [])].sort(),
    }));
    this.users = users.map((user, index) => ({
      id: user.id ?? `user-${String(index + 1).padStart(4, '0')}`,
      email: user.email.trim().toLowerCase(),
      passwordHash: user.passwordHash,
      firstName: user.firstName,
      lastName: user.lastName,
      patientId: user.patientId ?? null,
      status: user.status ?? USER_STATUSES.ACTIVE,
      mustChangePassword: Boolean(user.mustChangePassword),
      roleCodes: [...new Set(user.roleCodes ?? user.roles ?? [])],
      passwordChangedAt: user.passwordChangedAt ?? null,
      createdAt: user.createdAt ?? this.clock().toISOString(),
      updatedAt: user.updatedAt ?? this.clock().toISOString(),
    }));
    this.sessions = [];
    this.passwordResetTokens = [];
    this.loginAttempts = [];
    this.auditEvents = [];
    this.nextUserNumber = this.users.length + 1;
  }

  hydrateUser(user) {
    if (!user) return null;
    const roleRecords = user.roleCodes.map((code) => this.roles.find((role) => role.code === code)).filter(Boolean);
    return clone({
      ...user,
      roles: roleRecords.map((role) => role.code).sort(),
      permissions: [...new Set(roleRecords.flatMap((role) => role.permissions))].sort(),
    });
  }

  assertRoleCodes(roleCodes) {
    const known = new Set(this.roles.map((role) => role.code));
    const unknown = roleCodes.filter((code) => !known.has(code));
    if (unknown.length > 0) throw new StoreValidationError(`Unknown role code: ${unknown.join(', ')}`);
  }

  async healthCheck() {
    return { ok: true, driver: 'memory', provider: 'memory', simulated: true };
  }

  async close() {}

  async findUserByEmail(email) {
    return this.hydrateUser(this.users.find((user) => user.email === email.trim().toLowerCase()));
  }

  async findUserById(id) {
    return this.hydrateUser(this.users.find((user) => user.id === id));
  }

  async listUsers({ limit = 25, offset = 0, status, role } = {}) {
    let matches = [...this.users];
    if (status) matches = matches.filter((user) => user.status === status);
    if (role) matches = matches.filter((user) => user.roleCodes.includes(role));
    matches.sort((left, right) => left.email.localeCompare(right.email) || left.id.localeCompare(right.id));
    return {
      users: matches.slice(offset, offset + limit).map((user) => this.hydrateUser(user)),
      total: matches.length,
    };
  }

  async createUser(input) {
    const email = input.email.trim().toLowerCase();
    if (this.users.some((user) => user.email === email)) {
      throw new StoreConflictError('A user with this email address already exists');
    }
    this.assertRoleCodes(input.roleCodes);
    const now = this.clock().toISOString();
    const user = {
      id: input.id ?? `user-${String(this.nextUserNumber++).padStart(4, '0')}`,
      email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      patientId: input.patientId ?? null,
      status: input.status ?? USER_STATUSES.ACTIVE,
      mustChangePassword: Boolean(input.mustChangePassword),
      roleCodes: [...new Set(input.roleCodes)],
      passwordChangedAt: input.passwordChangedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(user);
    return this.hydrateUser(user);
  }

  async updateUser(id, updates) {
    const user = this.users.find((candidate) => candidate.id === id);
    if (!user) return null;
    if (updates.email !== undefined) {
      const email = updates.email.trim().toLowerCase();
      if (this.users.some((candidate) => candidate.id !== id && candidate.email === email)) {
        throw new StoreConflictError('A user with this email address already exists');
      }
      user.email = email;
    }
    if (updates.roleCodes !== undefined) {
      this.assertRoleCodes(updates.roleCodes);
      user.roleCodes = [...new Set(updates.roleCodes)];
    }
    for (const field of ['firstName', 'lastName', 'patientId', 'mustChangePassword']) {
      if (updates[field] !== undefined) user[field] = updates[field];
    }
    user.updatedAt = this.clock().toISOString();
    return this.hydrateUser(user);
  }

  async setUserStatus(id, status) {
    const user = this.users.find((candidate) => candidate.id === id);
    if (!user) return null;
    user.status = status;
    user.updatedAt = this.clock().toISOString();
    return this.hydrateUser(user);
  }

  async updatePassword(id, passwordHash, { mustChangePassword = false, changedAt = this.clock() } = {}) {
    const user = this.users.find((candidate) => candidate.id === id);
    if (!user) return null;
    user.passwordHash = passwordHash;
    user.mustChangePassword = mustChangePassword;
    user.passwordChangedAt = new Date(changedAt).toISOString();
    user.updatedAt = new Date(changedAt).toISOString();
    return this.hydrateUser(user);
  }

  async listRoles() {
    return clone([...this.roles].sort((left, right) => left.code.localeCompare(right.code)));
  }

  async createSession(session) {
    if (this.sessions.some((candidate) => candidate.tokenHash === session.tokenHash)) {
      throw new StoreConflictError('Session token collision');
    }
    this.sessions.push(clone(session));
    return clone(session);
  }

  async findSessionByTokenHash(tokenHash) {
    return clone(this.sessions.find((session) => session.tokenHash === tokenHash));
  }

  async rotateSession(currentSessionId, replacement, rotatedAt = this.clock()) {
    const current = this.sessions.find((session) => session.id === currentSessionId);
    if (!current || current.revokedAt) return false;
    current.revokedAt = new Date(rotatedAt).toISOString();
    current.revocationReason = 'ROTATED';
    current.replacedBySessionId = replacement.id;
    current.lastUsedAt = new Date(rotatedAt).toISOString();
    this.sessions.push(clone(replacement));
    return true;
  }

  async revokeSessionFamily(familyId, reason, revokedAt = this.clock()) {
    let count = 0;
    for (const session of this.sessions) {
      if (session.familyId === familyId && !session.revokedAt) {
        session.revokedAt = new Date(revokedAt).toISOString();
        session.revocationReason = reason;
        count += 1;
      }
    }
    return count;
  }

  async revokeSessionByTokenHash(tokenHash, reason, revokedAt = this.clock()) {
    const session = this.sessions.find((candidate) => candidate.tokenHash === tokenHash);
    if (!session || session.revokedAt) return false;
    session.revokedAt = new Date(revokedAt).toISOString();
    session.revocationReason = reason;
    return true;
  }

  async revokeAllUserSessions(userId, reason, revokedAt = this.clock()) {
    let count = 0;
    for (const session of this.sessions) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = new Date(revokedAt).toISOString();
        session.revocationReason = reason;
        count += 1;
      }
    }
    return count;
  }

  async createPasswordResetToken(resetToken) {
    for (const existing of this.passwordResetTokens) {
      if (existing.userId === resetToken.userId && !existing.consumedAt) {
        existing.consumedAt = resetToken.createdAt;
      }
    }
    this.passwordResetTokens.push(clone(resetToken));
    return clone(resetToken);
  }

  async findPasswordResetTokenByHash(tokenHash) {
    return clone(this.passwordResetTokens.find((token) => token.tokenHash === tokenHash));
  }

  async consumePasswordResetToken({ tokenHash, passwordHash, consumedAt = this.clock() }) {
    const token = this.passwordResetTokens.find((candidate) => candidate.tokenHash === tokenHash);
    const now = new Date(consumedAt);
    if (!token || token.consumedAt || new Date(token.expiresAt) <= now) return false;
    const user = this.users.find((candidate) => candidate.id === token.userId);
    if (!user) return false;
    token.consumedAt = now.toISOString();
    user.passwordHash = passwordHash;
    user.mustChangePassword = false;
    user.passwordChangedAt = now.toISOString();
    user.updatedAt = now.toISOString();
    await this.revokeAllUserSessions(user.id, 'PASSWORD_RESET', now);
    return true;
  }

  async recordLoginAttempt(attempt) {
    this.loginAttempts.push(clone(attempt));
  }

  async createAuditEvent(event) {
    this.auditEvents.push(clone(event));
  }

  async listUserAudit(userId, { limit, offset }) {
    const events = this.auditEvents.filter((event) => event.actorUserId === userId || (event.targetType === 'USER' && event.targetId === userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return { items: clone(events.slice(offset, offset + limit)), pagination: { limit, offset, total: events.length } };
  }
}
