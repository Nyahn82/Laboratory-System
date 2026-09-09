import { ApiError } from './errors.js';
import { extractBearerToken, verifyAccessToken } from './security.js';
import { USER_STATUSES } from './constants.js';

export function authenticate({ store, config }) {
  return async function authenticationMiddleware(req, _res, next) {
    const token = extractBearerToken(req.get('authorization'));
    if (!token) return next(new ApiError(401, 'AUTHENTICATION_REQUIRED', 'A valid access token is required'));

    try {
      const claims = verifyAccessToken(token, config);
      const user = await store.findUserById(claims.sub);
      if (!user || user.status !== USER_STATUSES.ACTIVE) {
        throw new ApiError(401, 'INVALID_ACCESS_TOKEN', 'The access token is no longer valid');
      }
      req.auth = { token, claims, user };
      return next();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      return next(new ApiError(401, 'INVALID_ACCESS_TOKEN', 'The access token is invalid or expired'));
    }
  };
}

export function requirePasswordReady(req, _res, next) {
  if (req.auth.user.mustChangePassword) {
    return next(new ApiError(
      403,
      'PASSWORD_CHANGE_REQUIRED',
      'The account password must be changed before this operation is allowed',
    ));
  }
  return next();
}

export function requireRoles(...allowedRoles) {
  return function roleMiddleware(req, _res, next) {
    const userRoles = new Set(req.auth?.user?.roles ?? []);
    if (!allowedRoles.some((role) => userRoles.has(role))) {
      return next(new ApiError(403, 'FORBIDDEN', 'The authenticated account is not allowed to perform this operation'));
    }
    return next();
  };
}
