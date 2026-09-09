export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'RHU LabChain Encrypted Storage Service',
    version: '0.1.0',
    description: 'Internal authenticated encryption and private object-storage API. Never submit plaintext directly to IPFS.',
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      internalToken: { type: 'apiKey', in: 'header', name: 'X-Internal-Service-Token' },
    },
    schemas: {
      Envelope: {
        type: 'object',
        required: ['success', 'message', 'data', 'errors'],
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          data: { type: 'object' },
          errors: { type: 'array', items: {} },
        },
      },
    },
  },
  paths: {
    '/health': { get: { summary: 'Liveness', responses: { 200: { description: 'Alive' } } } },
    '/ready': { get: { summary: 'Dependency readiness', responses: { 200: { description: 'Ready' }, 503: { description: 'Not ready' } } } },
    '/packages': {
      post: {
        summary: 'Canonicalize, encrypt, and store a finalized record version',
        security: [{ internalToken: [] }],
        parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['recordId', 'version', 'record'], properties: { recordId: { type: 'string' }, version: { type: 'integer', minimum: 1 }, record: { type: 'object' } } } } },
        },
        responses: { 201: { description: 'Encrypted package receipt' }, 200: { description: 'Idempotent existing receipt' } },
      },
    },
    '/packages/{recordId}/versions/{version}': {
      get: { summary: 'Retrieve and decrypt an authorized record', security: [{ internalToken: [] }], responses: { 200: { description: 'Verified plaintext returned only to the authorized caller' } } },
    },
    '/packages/{recordId}/versions/{version}/verify': {
      post: { summary: 'Verify object hash and authenticated encryption', security: [{ internalToken: [] }], responses: { 200: { description: 'Verification receipt without plaintext' } } },
    },
    '/admin/jobs': { get: { summary: 'List storage jobs', security: [{ internalToken: [] }], responses: { 200: { description: 'Jobs' } } } },
  },
};
