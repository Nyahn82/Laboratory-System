const standardResponses = {
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorized' },
  403: { $ref: '#/components/responses/Forbidden' },
};

const bearer = [{ bearerAuth: [] }];

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Laboratory Record Authentication Service',
    version: '0.1.0',
    description: 'Local identity, session, password, user, and role API. Nginx exposes these service-local routes under /api/auth.',
  },
  tags: [
    { name: 'Service' },
    { name: 'Authentication' },
    { name: 'Passwords' },
    { name: 'Users' },
    { name: 'Roles' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Service'],
        summary: 'Liveness probe',
        responses: { 200: { description: 'Process is alive', content: json('#/components/schemas/Envelope') } },
      },
    },
    '/ready': {
      get: {
        tags: ['Service'],
        summary: 'Dependency readiness probe',
        responses: {
          200: { description: 'Dependencies are ready', content: json('#/components/schemas/Envelope') },
          503: { description: 'A dependency is unavailable', content: json('#/components/schemas/ErrorEnvelope') },
        },
      },
    },
    '/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Authenticate and create a rotating refresh-token family',
        requestBody: body('#/components/schemas/LoginRequest'),
        responses: {
          200: { description: 'Access token returned and opaque refresh token set as an HttpOnly cookie', content: json('#/components/schemas/AuthEnvelope') },
          400: standardResponses[400],
          401: standardResponses[401],
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/refresh': {
      post: {
        tags: ['Authentication'],
        summary: 'Rotate an opaque refresh token and issue a new access token',
        requestBody: { required: false, content: json('#/components/schemas/RefreshRequest') },
        responses: {
          200: { description: 'Session rotated', content: json('#/components/schemas/AuthEnvelope') },
          401: standardResponses[401],
          403: standardResponses[403],
        },
      },
    },
    '/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Revoke the presented refresh session and clear its cookie',
        requestBody: { required: false, content: json('#/components/schemas/RefreshRequest') },
        responses: { 200: { description: 'Logout is idempotent', content: json('#/components/schemas/Envelope') } },
      },
    },
    '/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Return the authenticated account and effective permissions',
        security: bearer,
        responses: {
          200: { description: 'Current user', content: json('#/components/schemas/UserEnvelope') },
          401: standardResponses[401],
        },
      },
    },
    '/password/change': {
      post: {
        tags: ['Passwords'],
        summary: 'Change the current password and revoke refresh sessions',
        security: bearer,
        requestBody: body('#/components/schemas/PasswordChangeRequest'),
        responses: {
          200: { description: 'Password changed and replacement session issued', content: json('#/components/schemas/AuthEnvelope') },
          ...standardResponses,
        },
      },
    },
    '/password-reset/request': {
      post: {
        tags: ['Passwords'],
        summary: 'Create password reset instructions without revealing account existence',
        requestBody: body('#/components/schemas/PasswordResetRequest'),
        responses: {
          200: { description: 'Generic accepted response', content: json('#/components/schemas/Envelope') },
          400: standardResponses[400],
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/password-reset/confirm': {
      post: {
        tags: ['Passwords'],
        summary: 'Consume a one-time reset token and replace the password',
        requestBody: body('#/components/schemas/PasswordResetConfirmRequest'),
        responses: {
          200: { description: 'Password reset', content: json('#/components/schemas/Envelope') },
          400: standardResponses[400],
        },
      },
    },
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List users',
        security: bearer,
        parameters: [
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 25 }),
          queryParameter('offset', { type: 'integer', minimum: 0, default: 0 }),
          queryParameter('status', { $ref: '#/components/schemas/UserStatus' }),
          queryParameter('role', { $ref: '#/components/schemas/RoleCode' }),
        ],
        responses: { 200: { description: 'User page', content: json('#/components/schemas/UserListEnvelope') }, ...standardResponses },
      },
      post: {
        tags: ['Users'],
        summary: 'Create a user',
        security: bearer,
        requestBody: body('#/components/schemas/CreateUserRequest'),
        responses: { 201: { description: 'User created', content: json('#/components/schemas/UserEnvelope') }, ...standardResponses, 409: { $ref: '#/components/responses/Conflict' } },
      },
    },
    '/users/{id}': {
      parameters: [pathParameter('id')],
      get: {
        tags: ['Users'], summary: 'Get a user', security: bearer,
        responses: { 200: { description: 'User', content: json('#/components/schemas/UserEnvelope') }, ...standardResponses, 404: { $ref: '#/components/responses/NotFound' } },
      },
      patch: {
        tags: ['Users'], summary: 'Update identity fields or roles', security: bearer,
        requestBody: body('#/components/schemas/UpdateUserRequest'),
        responses: { 200: { description: 'User updated', content: json('#/components/schemas/UserEnvelope') }, ...standardResponses, 404: { $ref: '#/components/responses/NotFound' }, 409: { $ref: '#/components/responses/Conflict' } },
      },
      delete: {
        tags: ['Users'], summary: 'Soft-delete a user by disabling the account', security: bearer,
        responses: { 200: { description: 'User disabled', content: json('#/components/schemas/UserEnvelope') }, ...standardResponses, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/users/{id}/audit': {
      get: {
        tags: ['Users'], summary: 'Administrator: account access and account management trail', security: bearer,
        parameters: [pathParameter('id'),
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }],
        responses: { 200: { description: 'Newest-first events where the account is the actor or user target, with pagination', content: json('#/components/schemas/Envelope') }, ...standardResponses, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/users/{id}/status': {
      patch: {
        tags: ['Users'], summary: 'Set ACTIVE, DISABLED, or LOCKED status', security: bearer,
        parameters: [pathParameter('id')],
        requestBody: body('#/components/schemas/UserStatusRequest'),
        responses: { 200: { description: 'Status updated', content: json('#/components/schemas/UserEnvelope') }, ...standardResponses, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/roles': {
      get: {
        tags: ['Roles'], summary: 'List the exact supported roles and permissions', security: bearer,
        responses: { 200: { description: 'Role list', content: json('#/components/schemas/Envelope') }, ...standardResponses },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      refreshCookie: { type: 'apiKey', in: 'cookie', name: 'refresh_token' },
    },
    schemas: {
      RoleCode: { type: 'string', enum: ['SYSTEM_ADMIN', 'REGISTRATION_CASHIER', 'DOCTOR', 'LAB_STAFF', 'LAB_SUPERVISOR', 'PATIENT', 'PUBLIC_VERIFIER'] },
      UserStatus: { type: 'string', enum: ['ACTIVE', 'DISABLED', 'LOCKED'] },
      Error: {
        type: 'object', required: ['code', 'message'],
        properties: { code: { type: 'string' }, message: { type: 'string' }, path: { type: 'string' } },
      },
      Envelope: {
        type: 'object', required: ['success', 'message', 'data', 'errors'],
        properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: {}, errors: { type: 'array', items: { $ref: '#/components/schemas/Error' } } },
      },
      ErrorEnvelope: {
        allOf: [
          { $ref: '#/components/schemas/Envelope' },
          { type: 'object', properties: { success: { const: false }, data: { type: 'null' } } },
        ],
      },
      User: {
        type: 'object', required: ['id', 'email', 'firstName', 'lastName', 'status', 'mustChangePassword', 'roles', 'permissions'],
        properties: {
          id: { type: 'string' }, email: { type: 'string', format: 'email' }, firstName: { type: 'string' }, lastName: { type: 'string' },
          patientId: { type: ['string', 'null'] }, status: { $ref: '#/components/schemas/UserStatus' }, mustChangePassword: { type: 'boolean' },
          roles: { type: 'array', items: { $ref: '#/components/schemas/RoleCode' } }, permissions: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      UserEnvelope: { allOf: [{ $ref: '#/components/schemas/Envelope' }, { type: 'object', properties: { data: { $ref: '#/components/schemas/User' } } }] },
      UserListEnvelope: { allOf: [{ $ref: '#/components/schemas/Envelope' }] },
      AuthEnvelope: { allOf: [{ $ref: '#/components/schemas/Envelope' }] },
      LoginRequest: { type: 'object', additionalProperties: false, required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' } } },
      RefreshRequest: { type: 'object', additionalProperties: false, properties: { refreshToken: { type: 'string', writeOnly: true } } },
      PasswordChangeRequest: { type: 'object', additionalProperties: false, required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string', format: 'password' }, newPassword: { type: 'string', format: 'password', minLength: 12 } } },
      PasswordResetRequest: { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', format: 'email' } } },
      PasswordResetConfirmRequest: { type: 'object', additionalProperties: false, required: ['token', 'newPassword'], properties: { token: { type: 'string', writeOnly: true }, newPassword: { type: 'string', format: 'password', minLength: 12 } } },
      CreateUserRequest: {
        type: 'object', additionalProperties: false, required: ['email', 'firstName', 'lastName', 'password', 'roleCodes'],
        properties: { email: { type: 'string', format: 'email' }, firstName: { type: 'string' }, lastName: { type: 'string' }, password: { type: 'string', format: 'password', minLength: 12 }, patientId: { type: ['string', 'null'] }, status: { $ref: '#/components/schemas/UserStatus' }, mustChangePassword: { type: 'boolean', default: true }, roleCodes: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/RoleCode' } } },
      },
      UpdateUserRequest: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { email: { type: 'string', format: 'email' }, firstName: { type: 'string' }, lastName: { type: 'string' }, patientId: { type: ['string', 'null'] }, mustChangePassword: { type: 'boolean' }, roleCodes: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/RoleCode' } } },
      },
      UserStatusRequest: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { $ref: '#/components/schemas/UserStatus' } } },
    },
    responses: {
      BadRequest: response('Request validation failed'),
      Unauthorized: response('Authentication failed'),
      Forbidden: response('Operation is forbidden'),
      NotFound: response('Resource not found'),
      Conflict: response('Resource conflicts with an existing record'),
      RateLimited: response('Rate limit exceeded'),
    },
  },
};

function json(schemaReference) {
  return { 'application/json': { schema: { $ref: schemaReference } } };
}

function body(schemaReference) {
  return { required: true, content: json(schemaReference) };
}

function response(description) {
  return { description, content: json('#/components/schemas/ErrorEnvelope') };
}

function pathParameter(name) {
  return { name, in: 'path', required: true, schema: { type: 'string' } };
}

function queryParameter(name, schema) {
  return { name, in: 'query', required: false, schema };
}
