export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'RHU LabChain Verification Service',
    version: '0.1.0',
    description: 'Registers opaque encrypted-record proofs and serves a strictly redacted QR verification response.',
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, internalToken: { type: 'apiKey', in: 'header', name: 'X-Internal-Service-Token' } },
  },
  paths: {
    '/nodes': { get: { summary: 'Administrator: ledger query and individual Fabric node health', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Timestamped ledger and node checks, including unavailable and simulated states' }, 401: { description: 'Sign-in required' }, 403: { description: 'Active administrator with completed password change required' }, 503: { description: 'Account verification unavailable' } } } },
    '/health': { get: { summary: 'Liveness', responses: { 200: { description: 'Alive' } } } },
    '/ready': { get: { summary: 'Database and ledger readiness', responses: { 200: { description: 'Ready' }, 503: { description: 'Not ready' } } } },
    '/registrations': { post: { summary: 'Register an opaque encrypted record proof', security: [{ internalToken: [] }], responses: { 201: { description: 'Committed' }, 200: { description: 'Duplicate' } } } },
    '/records/{recordId}/versions/{version}/release': { post: { summary: 'Commit release and issue a one-time returned QR token', security: [{ internalToken: [] }], responses: { 200: { description: 'Released' } } } },
    '/records/{recordId}/versions/{version}/revoke': { post: { summary: 'Revoke a proof and its QR tokens', security: [{ internalToken: [] }], responses: { 200: { description: 'Revoked' } } } },
    '/records/{recordId}/history': { get: { summary: 'Get append-only ledger history', security: [{ internalToken: [] }], responses: { 200: { description: 'History' } } } },
    '/public/{token}': { get: { summary: 'Return redacted public validity information', responses: { 200: { description: 'Always redacted; invalid tokens do not disclose records' } } } },
    '/public/verify/{token}': { get: { summary: 'Compatibility alias for redacted public verification', responses: { 200: { description: 'Always redacted; invalid tokens do not disclose records' } } } },
  },
};
