import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function hashPassword(password, rounds) {
  return bcrypt.hash(password, rounds);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function createOpaqueToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashOpaqueToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function defaultIdFactory() {
  return crypto.randomUUID();
}

export function permissionsForUser(user) {
  return [...new Set(user.permissions ?? [])].sort();
}

export function signAccessToken(user, config, idFactory = defaultIdFactory) {
  const roles = [...new Set(user.roles ?? [])].sort();
  const permissions = permissionsForUser(user);
  const payload = {
    sub: user.id,
    email: user.email,
    roles,
    permissions,
    patientId: user.patientId ?? null,
    mustChangePassword: Boolean(user.mustChangePassword),
    type: 'access',
  };

  return jwt.sign(payload, config.jwtAccessSecret, {
    algorithm: 'HS256',
    audience: config.jwtAudience,
    issuer: config.jwtIssuer,
    expiresIn: config.jwtAccessTtlSeconds,
    jwtid: idFactory(),
  });
}

export function verifyAccessToken(token, config) {
  const claims = jwt.verify(token, config.jwtAccessSecret, {
    algorithms: ['HS256'],
    audience: config.jwtAudience,
    issuer: config.jwtIssuer,
  });
  if (typeof claims === 'string' || claims.type !== 'access' || !claims.sub) {
    throw new jwt.JsonWebTokenError('Invalid access token claims');
  }
  return claims;
}

export function extractBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match?.[1] ?? null;
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    patientId: user.patientId ?? null,
    status: user.status,
    mustChangePassword: Boolean(user.mustChangePassword),
    roles: [...new Set(user.roles ?? [])].sort(),
    permissions: permissionsForUser(user),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
