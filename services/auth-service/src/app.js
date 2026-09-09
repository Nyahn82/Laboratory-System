import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { AuthService } from './auth-service.js';
import { loadConfig } from './config.js';
import { ApiError } from './errors.js';
import {
  asyncHandler,
  errorHandler,
  errorPayload,
  notFoundHandler,
  requestContext,
  requestLogger,
  sendSuccess,
  validate,
} from './http.js';
import { authenticate, requirePasswordReady, requireRoles } from './middleware.js';
import { logger as defaultLogger } from './logger.js';
import { publicUser } from './security.js';
import { createAuthStore } from './stores/index.js';
import { openApiDocument } from './openapi.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  loginSchema,
  logoutSchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshSchema,
  updateUserSchema,
  userStatusSchema,
} from './validation.js';

function clientContext(req) {
  return {
    requestId: req.requestId,
    correlationId: req.correlationId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
  };
}

function refreshTokenFromRequest(req, config) {
  return req.body?.refreshToken ?? req.cookies?.[config.cookieName] ?? null;
}

function refreshCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: config.refreshTokenTtlSeconds * 1000,
  };
}

function clearRefreshCookie(res, config) {
  const options = refreshCookieOptions(config);
  delete options.maxAge;
  res.clearCookie(config.cookieName, options);
}

function publicTokenResult(result) {
  const { refreshToken: _refreshToken, ...publicResult } = result;
  return publicResult;
}

function createLimiter(config, options) {
  if (!config.rateLimitEnabled) return (_req, _res, next) => next();
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...options,
    handler: (_req, res) => res.status(429).json(errorPayload(
      'RATE_LIMITED',
      'Too many requests; retry after the rate-limit window',
    )),
  });
}

export function createApp(options = {}) {
  const config = loadConfig(options.config);
  const store = options.store ?? createAuthStore(config);
  const logger = options.logger ?? defaultLogger;
  const authService = options.authService ?? new AuthService({
    store,
    config,
    clock: options.clock,
    idFactory: options.idFactory,
    tokenFactory: options.tokenFactory,
  });
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.locals.config = config;
  app.locals.store = store;
  app.locals.authService = authService;

  app.use(requestContext);
  app.use(requestLogger(logger));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => sendSuccess(res, {
    message: 'Authentication service is running',
    data: { status: 'healthy', service: 'auth-service', version: '0.1.0' },
  }));
  app.get('/ready', asyncHandler(async (_req, res) => {
    try {
      const result = await store.healthCheck();
      const dependency = result && typeof result === 'object'
        ? { status: result.ok === false ? 'not_ready' : 'ready', ...result }
        : {
          status: 'ready',
          driver: config.dbDriver ?? config.storeKind ?? 'memory',
          simulated: (config.dbDriver ?? config.storeKind) !== 'mysql',
        };
      if (dependency.ok === false) {
        return res.status(503).json(errorPayload('NOT_READY', 'Authentication service dependencies are unavailable'));
      }
      return sendSuccess(res, {
        message: 'Authentication service is ready',
        data: { status: 'ready', dependencies: { store: dependency } },
      });
    } catch {
      return res.status(503).json(errorPayload('NOT_READY', 'Authentication service dependencies are unavailable'));
    }
  }));
  app.get('/openapi.json', (_req, res) => res.json(openApiDocument));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { explorer: false }));

  const generalLimiter = createLimiter(config, { windowMs: 60_000, limit: 120 });
  const loginLimiter = createLimiter(config, { windowMs: 15 * 60_000, limit: 10 });
  app.use(generalLimiter);

  app.post('/login', loginLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
    const result = await authService.login(req.body, clientContext(req));
    res.cookie(config.cookieName, result.refreshToken, refreshCookieOptions(config));
    return sendSuccess(res, { message: 'Login successful', data: publicTokenResult(result) });
  }));

  app.post('/refresh', validate(refreshSchema), asyncHandler(async (req, res) => {
    const result = await authService.refresh(refreshTokenFromRequest(req, config), clientContext(req));
    res.cookie(config.cookieName, result.refreshToken, refreshCookieOptions(config));
    return sendSuccess(res, { message: 'Session refreshed', data: publicTokenResult(result) });
  }));

  app.post('/logout', validate(logoutSchema), asyncHandler(async (req, res) => {
    await authService.logout(refreshTokenFromRequest(req, config), clientContext(req));
    clearRefreshCookie(res, config);
    return sendSuccess(res, { message: 'Logout successful', data: null });
  }));

  app.post('/password-reset/request', loginLimiter, validate(passwordResetRequestSchema), asyncHandler(async (req, res) => {
    const data = await authService.requestPasswordReset(req.body.email, clientContext(req));
    return sendSuccess(res, {
      message: 'If the account is eligible, password reset instructions have been created',
      data,
    });
  }));

  app.post('/password-reset/confirm', loginLimiter, validate(passwordResetConfirmSchema), asyncHandler(async (req, res) => {
    await authService.confirmPasswordReset(req.body, clientContext(req));
    clearRefreshCookie(res, config);
    return sendSuccess(res, { message: 'Password reset successful', data: null });
  }));

  const requireAuthentication = authenticate({ store, config });
  app.get('/me', requireAuthentication, asyncHandler(async (req, res) => sendSuccess(res, {
    message: 'Authenticated user retrieved',
    data: publicUser(req.auth.user),
  })));

  app.post('/password/change', requireAuthentication, validate(passwordChangeSchema), asyncHandler(async (req, res) => {
    const user = await authService.changePassword(req.auth.user, req.body, clientContext(req));
    const { rawToken, session } = authService.buildSession(user.id, clientContext(req));
    await store.createSession(session);
    const result = authService.accessResult(user, rawToken);
    res.cookie(config.cookieName, result.refreshToken, refreshCookieOptions(config));
    return sendSuccess(res, {
      message: 'Password changed; prior sessions were revoked and a new session was issued',
      data: publicTokenResult(result),
    });
  }));

  const adminOnly = [requireAuthentication, requirePasswordReady, requireRoles('SYSTEM_ADMIN')];
  app.get('/users', ...adminOnly, validate(listUsersQuerySchema, 'query'), asyncHandler(async (req, res) => sendSuccess(res, {
    message: 'Users retrieved',
    data: await authService.listUsers(req.query),
  })));
  app.post('/users', ...adminOnly, validate(createUserSchema), asyncHandler(async (req, res) => sendSuccess(res, {
    status: 201,
    message: 'User created',
    data: await authService.createUser(req.body, req.auth.user, clientContext(req)),
  })));
  app.get('/users/:id', ...adminOnly, asyncHandler(async (req, res) => sendSuccess(res, {
    message: 'User retrieved',
    data: await authService.getUser(req.params.id),
  })));
  app.get('/users/:id/audit', ...adminOnly, validate(listUsersQuerySchema.pick({ limit: true, offset: true }), 'query'), asyncHandler(async (req, res) => sendSuccess(res, {
    message: 'Account audit trail retrieved',
    data: await authService.getUserAudit(req.params.id, req.query),
  })));
  app.patch('/users/:id', ...adminOnly, validate(updateUserSchema), asyncHandler(async (req, res) => sendSuccess(res, {
    message: 'User updated',
    data: await authService.updateUser(req.params.id, req.body, req.auth.user, clientContext(req)),
  })));
  app.patch('/users/:id/status', ...adminOnly, validate(userStatusSchema), asyncHandler(async (req, res) => sendSuccess(res, {
    message: 'User status updated',
    data: await authService.setUserStatus(req.params.id, req.body.status, req.auth.user, clientContext(req)),
  })));
  app.delete('/users/:id', ...adminOnly, asyncHandler(async (req, res) => sendSuccess(res, {
    message: 'User disabled',
    data: await authService.deleteUser(req.params.id, req.auth.user, clientContext(req)),
  })));
  app.get('/roles', ...adminOnly, asyncHandler(async (_req, res) => sendSuccess(res, {
    message: 'Roles retrieved',
    data: { items: await authService.listRoles() },
  })));

  app.use(notFoundHandler);
  app.use(errorHandler(logger, config.nodeEnv));
  return app;
}

export { ApiError };
