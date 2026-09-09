import { ApiError } from './errors.js';
import { USER_STATUSES } from './constants.js';
import {
  createOpaqueToken,
  defaultIdFactory,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  publicUser,
  signAccessToken,
  verifyPassword,
} from './security.js';

export class AuthService {
  constructor({
    store,
    config,
    clock = () => new Date(),
    idFactory = defaultIdFactory,
    tokenFactory = createOpaqueToken,
  }) {
    this.store = store;
    this.config = config;
    this.clock = clock;
    this.idFactory = idFactory;
    this.tokenFactory = tokenFactory;
    this.dummyPasswordHash = hashPassword(this.tokenFactory(), config.bcryptRounds);
  }

  now() {
    return new Date(this.clock());
  }

  async writeAudit(context, event) {
    await this.store.createAuditEvent({
      id: this.idFactory(),
      actorUserId: event.actorUserId ?? null,
      eventType: event.eventType,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      outcome: event.outcome ?? 'SUCCESS',
      requestId: context.requestId ?? null,
      correlationId: context.correlationId ?? null,
      ipAddress: context.ipAddress ?? null,
      metadata: event.metadata ?? {},
      createdAt: this.now().toISOString(),
    });
  }

  buildSession(userId, context, familyId = this.idFactory()) {
    const now = this.now();
    const rawToken = this.tokenFactory();
    const session = {
      id: this.idFactory(),
      familyId,
      userId,
      tokenHash: hashOpaqueToken(rawToken),
      userAgent: context.userAgent ?? null,
      ipAddress: context.ipAddress ?? null,
      expiresAt: new Date(now.getTime() + this.config.refreshTokenTtlSeconds * 1000).toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      createdAt: now.toISOString(),
    };
    return { rawToken, session };
  }

  accessResult(user, refreshToken) {
    return {
      accessToken: signAccessToken(user, this.config, this.idFactory),
      tokenType: 'Bearer',
      expiresIn: this.config.jwtAccessTtlSeconds,
      refreshToken,
      user: publicUser(user),
    };
  }

  async login({ email, password }, context) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.store.findUserByEmail(normalizedEmail);
    const candidateHash = user?.passwordHash ?? await this.dummyPasswordHash;
    const passwordMatches = await verifyPassword(password, candidateHash);
    const accepted = Boolean(user && passwordMatches && user.status === USER_STATUSES.ACTIVE);
    const attemptedAt = this.now().toISOString();

    await this.store.recordLoginAttempt({
      id: this.idFactory(),
      email: normalizedEmail,
      userId: user?.id ?? null,
      success: accepted,
      failureReason: accepted ? null : 'INVALID_CREDENTIALS_OR_STATUS',
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      attemptedAt,
    });

    if (!accepted) {
      await this.writeAudit(context, {
        actorUserId: user?.id,
        eventType: 'AUTH_LOGIN',
        targetType: 'USER',
        targetId: user?.id,
        outcome: 'DENIED',
        metadata: { reason: 'INVALID_CREDENTIALS_OR_STATUS' },
      });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is invalid');
    }

    const { rawToken, session } = this.buildSession(user.id, context);
    await this.store.createSession(session);
    await this.writeAudit(context, {
      actorUserId: user.id,
      eventType: 'AUTH_LOGIN',
      targetType: 'SESSION',
      targetId: session.id,
      outcome: 'SUCCESS',
    });
    return this.accessResult(user, rawToken);
  }

  async refresh(rawToken, context) {
    if (!rawToken) throw new ApiError(401, 'REFRESH_TOKEN_REQUIRED', 'A refresh token is required');
    const tokenHash = hashOpaqueToken(rawToken);
    const existing = await this.store.findSessionByTokenHash(tokenHash);
    if (!existing) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'The refresh token is invalid');

    if (existing.revokedAt) {
      await this.store.revokeSessionFamily(existing.familyId, 'REFRESH_TOKEN_REUSE', this.now());
      await this.writeAudit(context, {
        actorUserId: existing.userId,
        eventType: 'AUTH_REFRESH_REUSE',
        targetType: 'SESSION_FAMILY',
        targetId: existing.familyId,
        outcome: 'DENIED',
      });
      throw new ApiError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token reuse was detected; the session family was revoked');
    }

    if (new Date(existing.expiresAt) <= this.now()) {
      await this.store.revokeSessionFamily(existing.familyId, 'EXPIRED', this.now());
      throw new ApiError(401, 'REFRESH_TOKEN_EXPIRED', 'The refresh token has expired');
    }

    const user = await this.store.findUserById(existing.userId);
    if (!user || user.status !== USER_STATUSES.ACTIVE) {
      await this.store.revokeSessionFamily(existing.familyId, 'ACCOUNT_UNAVAILABLE', this.now());
      throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'The refresh token is no longer valid');
    }
    if (user.mustChangePassword) {
      throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change the account password before refreshing the session');
    }

    const { rawToken: replacementToken, session: replacement } = this.buildSession(
      user.id,
      context,
      existing.familyId,
    );
    const rotated = await this.store.rotateSession(existing.id, replacement, this.now());
    if (!rotated) {
      await this.store.revokeSessionFamily(existing.familyId, 'REFRESH_TOKEN_REUSE', this.now());
      throw new ApiError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token reuse was detected; the session family was revoked');
    }
    await this.writeAudit(context, {
      actorUserId: user.id,
      eventType: 'AUTH_REFRESH',
      targetType: 'SESSION',
      targetId: replacement.id,
      outcome: 'SUCCESS',
    });
    return this.accessResult(user, replacementToken);
  }

  async logout(rawToken, context) {
    let actorUserId = null;
    if (rawToken) {
      const tokenHash = hashOpaqueToken(rawToken);
      const session = await this.store.findSessionByTokenHash(tokenHash);
      actorUserId = session?.userId ?? null;
      await this.store.revokeSessionByTokenHash(tokenHash, 'LOGOUT', this.now());
    }
    await this.writeAudit(context, {
      actorUserId,
      eventType: 'AUTH_LOGOUT',
      targetType: 'SESSION',
      outcome: 'SUCCESS',
    });
  }

  async changePassword(user, { currentPassword, newPassword }, context) {
    if (!await verifyPassword(currentPassword, user.passwordHash)) {
      await this.writeAudit(context, {
        actorUserId: user.id,
        eventType: 'PASSWORD_CHANGE',
        targetType: 'USER',
        targetId: user.id,
        outcome: 'DENIED',
      });
      throw new ApiError(401, 'CURRENT_PASSWORD_INVALID', 'The current password is invalid');
    }
    const passwordHash = await hashPassword(newPassword, this.config.bcryptRounds);
    const updated = await this.store.updatePassword(user.id, passwordHash, {
      mustChangePassword: false,
      changedAt: this.now(),
    });
    await this.store.revokeAllUserSessions(user.id, 'PASSWORD_CHANGED', this.now());
    await this.writeAudit(context, {
      actorUserId: user.id,
      eventType: 'PASSWORD_CHANGE',
      targetType: 'USER',
      targetId: user.id,
      outcome: 'SUCCESS',
    });
    return publicUser(updated);
  }

  async requestPasswordReset(email, context) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.store.findUserByEmail(normalizedEmail);
    let resetToken = null;
    if (user?.status === USER_STATUSES.ACTIVE) {
      resetToken = this.tokenFactory();
      const now = this.now();
      await this.store.createPasswordResetToken({
        id: this.idFactory(),
        userId: user.id,
        tokenHash: hashOpaqueToken(resetToken),
        expiresAt: new Date(now.getTime() + this.config.passwordResetTtlSeconds * 1000).toISOString(),
        consumedAt: null,
        createdAt: now.toISOString(),
      });
      await this.writeAudit(context, {
        actorUserId: user.id,
        eventType: 'PASSWORD_RESET_REQUEST',
        targetType: 'USER',
        targetId: user.id,
        outcome: 'SUCCESS',
      });
    }
    return this.config.exposeResetToken && resetToken ? { resetToken } : null;
  }

  async confirmPasswordReset({ token, newPassword }, context) {
    const tokenHash = hashOpaqueToken(token);
    const reset = await this.store.findPasswordResetTokenByHash(tokenHash);
    if (!reset || reset.consumedAt || new Date(reset.expiresAt) <= this.now()) {
      throw new ApiError(400, 'INVALID_RESET_TOKEN', 'The password reset token is invalid or expired');
    }
    const user = await this.store.findUserById(reset.userId);
    if (!user || user.status !== USER_STATUSES.ACTIVE) {
      throw new ApiError(400, 'INVALID_RESET_TOKEN', 'The password reset token is invalid or expired');
    }
    const passwordHash = await hashPassword(newPassword, this.config.bcryptRounds);
    const consumed = await this.store.consumePasswordResetToken({
      tokenHash,
      passwordHash,
      consumedAt: this.now(),
    });
    if (!consumed) throw new ApiError(400, 'INVALID_RESET_TOKEN', 'The password reset token is invalid or expired');
    await this.writeAudit(context, {
      actorUserId: user.id,
      eventType: 'PASSWORD_RESET_CONFIRM',
      targetType: 'USER',
      targetId: user.id,
      outcome: 'SUCCESS',
    });
  }

  async listUsers(query) {
    const result = await this.store.listUsers(query);
    return {
      items: result.users.map(publicUser),
      pagination: { limit: query.limit, offset: query.offset, total: result.total },
    };
  }

  async getUser(id) {
    const user = await this.store.findUserById(id);
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'The requested user was not found');
    return publicUser(user);
  }

  async getUserAudit(id, query) {
    await this.getUser(id);
    const result = await this.store.listUserAudit(id, query);
    return { ...result, items: result.items.map(({ id: eventId, actorUserId, eventType, targetType, targetId, outcome, requestId, correlationId, ipAddress, createdAt }) =>
      ({ id: eventId, actorUserId, eventType, targetType, targetId, outcome, requestId, correlationId, ipAddress, createdAt })) };
  }

  async createUser(input, actor, context) {
    const passwordHash = await hashPassword(input.password, this.config.bcryptRounds);
    const user = await this.store.createUser({
      id: this.idFactory(),
      email: normalizeEmail(input.email),
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      patientId: input.patientId ?? null,
      status: input.status,
      mustChangePassword: input.mustChangePassword,
      roleCodes: input.roleCodes,
      passwordChangedAt: null,
    });
    await this.writeAudit(context, {
      actorUserId: actor.id,
      eventType: 'USER_CREATE',
      targetType: 'USER',
      targetId: user.id,
      outcome: 'SUCCESS',
      metadata: { roleCodes: user.roles, status: user.status },
    });
    return publicUser(user);
  }

  async updateUser(id, updates, actor, context) {
    const user = await this.store.updateUser(id, {
      ...updates,
      email: updates.email ? normalizeEmail(updates.email) : undefined,
    });
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'The requested user was not found');
    await this.writeAudit(context, {
      actorUserId: actor.id,
      eventType: 'USER_UPDATE',
      targetType: 'USER',
      targetId: user.id,
      outcome: 'SUCCESS',
      metadata: { changedFields: Object.keys(updates).sort() },
    });
    return publicUser(user);
  }

  async setUserStatus(id, status, actor, context) {
    const user = await this.store.setUserStatus(id, status);
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'The requested user was not found');
    if (status !== USER_STATUSES.ACTIVE) {
      await this.store.revokeAllUserSessions(id, 'ACCOUNT_STATUS_CHANGED', this.now());
    }
    await this.writeAudit(context, {
      actorUserId: actor.id,
      eventType: 'USER_STATUS_CHANGE',
      targetType: 'USER',
      targetId: user.id,
      outcome: 'SUCCESS',
      metadata: { status },
    });
    return publicUser(user);
  }

  async deleteUser(id, actor, context) {
    return this.setUserStatus(id, USER_STATUSES.DISABLED, actor, context);
  }

  async listRoles() {
    return this.store.listRoles();
  }
}
