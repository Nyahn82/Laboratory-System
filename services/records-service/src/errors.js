export class ApiError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED', errors = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errors = Array.isArray(errors) ? errors : [errors];
  }
}

export function assertFound(value, label = 'Resource') {
  if (!value) throw new ApiError(404, `${label} was not found.`, 'NOT_FOUND');
  return value;
}

export function assertCondition(condition, status, message, code, errors = []) {
  if (!condition) throw new ApiError(status, message, code, errors);
}
