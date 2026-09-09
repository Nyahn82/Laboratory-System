import { randomUUID, createHash } from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { ApiError } from './errors.js';
import { ROLES } from './domain/statuses.js';

export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

export function securityMiddleware(config) {
  const allowed = new Set(config.corsOrigins);
  return [
    helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }),
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || allowed.has(origin)) return callback(null, true);
        callback(new ApiError(403, 'Origin is not allowed.', 'CORS_DENIED'));
      },
    }),
  ];
}

export function authenticate(secret) {
  return (req, _res, next) => {
    const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
    if (!match) return next(new ApiError(401, 'Authentication is required.', 'AUTH_REQUIRED'));
    try {
      const payload = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
      const roles = Array.isArray(payload.roles) ? payload.roles : payload.role ? [payload.role] : [];
      if (!roles.length || roles.some((role) => !ROLES.includes(role))) {
        return next(new ApiError(401, 'The token contains unsupported role claims.', 'TOKEN_ROLES_INVALID'));
      }
      req.user = {
        ...payload,
        id: String(payload.sub || payload.userId || ''),
        roles,
        staffId: payload.staffId ? String(payload.staffId) : null,
        physicianId: payload.physicianId ? String(payload.physicianId) : null,
        patientId: payload.patientId ? String(payload.patientId) : null,
      };
      if (!req.user.id) return next(new ApiError(401, 'The token subject is missing.', 'TOKEN_SUBJECT_INVALID'));
      return next();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      return next(new ApiError(401, 'The access token is invalid or expired.', 'TOKEN_INVALID'));
    }
  };
}

export function allowRoles(...roles) {
  const allowed = new Set(roles);
  return (req, _res, next) => {
    if (!req.user?.roles?.some((role) => allowed.has(role))) {
      return next(new ApiError(403, 'You do not have permission to perform this action.', 'ROLE_FORBIDDEN'));
    }
    next();
  };
}

export function validate(schemas = {}) {
  return (req, _res, next) => {
    try {
      req.validated = {
        body: schemas.body ? schemas.body.parse(req.body) : req.body,
        params: schemas.params ? schemas.params.parse(req.params) : req.params,
        query: schemas.query ? schemas.query.parse(req.query) : req.query,
      };
      next();
    } catch (error) {
      if (error?.issues) {
        return next(new ApiError(400, 'Request validation failed.', 'VALIDATION_FAILED', error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }))));
      }
      next(error);
    }
  };
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function sendSuccess(res, status, message, data = {}) {
  return res.status(status).json({ success: true, message, data, errors: [] });
}

export function requireIdempotencyKey(req) {
  const value = req.get('idempotency-key');
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new ApiError(400, 'A valid Idempotency-Key header is required.', 'IDEMPOTENCY_KEY_REQUIRED', [{
      field: 'Idempotency-Key',
      message: 'Use 8-128 letters, digits, dots, underscores, colons, or hyphens.',
    }]);
  }
  return value;
}

export function hashRequest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function notFound(req, _res, next) {
  next(new ApiError(404, `Route ${req.method} ${req.originalUrl} was not found.`, 'NOT_FOUND'));
}

export function errorHandler(error, req, res, _next) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) {
    console.error(JSON.stringify({ level: 'error', service: 'records-service', requestId: req.requestId, code: error.code || 'INTERNAL_ERROR', message: error.message }));
  }
  res.status(status).json({
    success: false,
    message: status < 500 ? error.message : 'An unexpected service error occurred.',
    data: {},
    errors: status < 500 ? error.errors || [] : [],
  });
}
