import { timingSafeEqual } from 'node:crypto';
import { ApiError } from '@rhu-labchain/service-kit';

export function requireInternalToken(expectedToken) {
  const expected = Buffer.from(expectedToken, 'utf8');
  return (req, _res, next) => {
    const supplied = Buffer.from(req.get('x-internal-service-token') || '', 'utf8');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return next(new ApiError(401, 'Valid service authentication is required.', [], 'SERVICE_AUTH_REQUIRED'));
    }
    req.callerService = (req.get('x-caller-service') || 'unknown-service').slice(0, 80);
    return next();
  };
}
