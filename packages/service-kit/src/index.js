import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';

export const ROLES = Object.freeze({
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  REGISTRATION_CASHIER: 'REGISTRATION_CASHIER',
  DOCTOR: 'DOCTOR',
  LAB_STAFF: 'LAB_STAFF',
  LAB_SUPERVISOR: 'LAB_SUPERVISOR',
  PATIENT: 'PATIENT',
  PUBLIC_VERIFIER: 'PUBLIC_VERIFIER',
});

export class ApiError extends Error {
  constructor(status, message, errors = [], code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.code = code;
  }
}

export function sendSuccess(res, status, message, data = {}) {
  return res.status(status).json({ success: true, message, data, errors: [] });
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  const requestId = incoming && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}

export function standardSecurity({ corsOrigins = [], isPublic = false } = {}) {
  const allowed = new Set(corsOrigins.filter(Boolean));
  return [
    helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }),
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || isPublic || allowed.has(origin)) return callback(null, true);
        return callback(new ApiError(403, 'Origin is not allowed.', [], 'CORS_DENIED'));
      },
    }),
  ];
}

export function authenticateJwt(secret) {
  if (!secret) throw new Error('AUTH_JWT_SECRET is required.');
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return next(new ApiError(401, 'Authentication is required.', [], 'AUTH_REQUIRED'));
    try {
      req.user = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
      if (req.user.mustChangePassword) {
        return next(new ApiError(403, 'Password change is required before using this service.', [], 'PASSWORD_CHANGE_REQUIRED'));
      }
      return next();
    } catch {
      return next(new ApiError(401, 'The access token is invalid or expired.', [], 'TOKEN_INVALID'));
    }
  };
}

export function allowRoles(...allowedRoles) {
  const allowed = new Set(allowedRoles);
  return (req, _res, next) => {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (!roles.some((role) => allowed.has(role))) {
      return next(new ApiError(403, 'You do not have permission to perform this action.', [], 'ROLE_FORBIDDEN'));
    }
    return next();
  };
}

export function requireInternalToken(expectedToken) {
  if (!expectedToken) throw new Error('INTERNAL_SERVICE_TOKEN is required.');
  return (req, _res, next) => {
    const supplied = req.get('x-internal-service-token');
    const suppliedBytes = Buffer.from(supplied || '', 'utf8');
    const expectedBytes = Buffer.from(expectedToken, 'utf8');
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      return next(new ApiError(401, 'Valid service authentication is required.', [], 'SERVICE_AUTH_REQUIRED'));
    }
    next();
  };
}

export function notFound(req, _res, next) {
  next(new ApiError(404, `Route ${req.method} ${req.originalUrl} was not found.`, [], 'NOT_FOUND'));
}

export function errorHandler(error, req, res, _next) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  const expose = status < 500;
  if (status >= 500) {
    console.error(JSON.stringify({
      level: 'error',
      service: process.env.SERVICE_NAME,
      requestId: req.requestId,
      code: error.code || 'INTERNAL_ERROR',
      message: error.message,
    }));
  }
  res.status(status).json({
    success: false,
    message: expose ? error.message : 'An unexpected service error occurred.',
    data: {},
    errors: expose ? error.errors || [] : [],
  });
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value instanceof Date ? value.toISOString() : value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function requireIdempotencyKey(req) {
  const key = req.get('idempotency-key');
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(400, 'A valid Idempotency-Key header is required.', [
      { field: 'Idempotency-Key', message: 'Use 8-128 letters, digits, dots, underscores, colons, or hyphens.' },
    ], 'IDEMPOTENCY_KEY_REQUIRED');
  }
  return key;
}

export function utcNow() {
  return new Date().toISOString();
}
