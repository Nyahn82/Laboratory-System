import crypto from 'node:crypto';
import { ZodError } from 'zod';
import { ApiError, StoreConflictError, StoreValidationError } from './errors.js';

export function sendSuccess(res, { status = 200, message, data = null }) {
  return res.status(status).json({ success: true, message, data, errors: [] });
}

export function errorPayload(code, message, details = []) {
  const normalizedDetails = details.length > 0 ? details : [{ code, message }];
  return { success: false, message, data: null, errors: normalizedDetails };
}

export function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function requestContext(req, res, next) {
  const suppliedRequestId = cleanRequestIdentifier(req.get('x-request-id'));
  const suppliedCorrelationId = cleanRequestIdentifier(req.get('x-correlation-id'));
  req.requestId = suppliedRequestId ?? crypto.randomUUID();
  req.correlationId = suppliedCorrelationId ?? req.requestId;
  res.set('x-request-id', req.requestId);
  res.set('x-correlation-id', req.correlationId);
  next();
}

function cleanRequestIdentifier(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(candidate)) return null;
  return candidate;
}

export function requestLogger(logger) {
  return function logRequest(req, res, next) {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      logger.info('http_request', {
        requestId: req.requestId,
        correlationId: req.correlationId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    });
    next();
  };
}

export function validate(schema, location = 'body') {
  return function validateRequest(req, _res, next) {
    const result = schema.safeParse(req[location]);
    if (!result.success) return next(result.error);
    req[location] = result.data;
    return next();
  };
}

export function notFoundHandler(req, _res, next) {
  next(new ApiError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} was not found`));
}

export function errorHandler(logger, nodeEnv = 'development') {
  return function handleError(error, req, res, _next) {
    if (res.headersSent) return;

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details = [];

    if (error instanceof ApiError) {
      status = error.status;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (error instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = error.errors.map((issue) => ({
        code: 'INVALID_FIELD',
        message: issue.message,
        path: issue.path.join('.'),
      }));
    } else if (error instanceof StoreConflictError) {
      status = 409;
      code = 'CONFLICT';
      message = error.message;
    } else if (error instanceof StoreValidationError) {
      status = 400;
      code = 'INVALID_REFERENCE';
      message = error.message;
    } else if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Request body contains invalid JSON';
    }

    if (status >= 500) {
      logger.error('request_error', {
        requestId: req.requestId,
        correlationId: req.correlationId,
        errorName: error?.name,
        errorCode: error?.code,
      });
    }

    if (nodeEnv !== 'production' && status >= 500 && error?.name) {
      details = [{ code, message: `${error.name}: ${message}` }];
    }

    res.status(status).json(errorPayload(code, message, details));
  };
}
