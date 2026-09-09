export class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class StoreConflictError extends Error {
  constructor(message = 'The requested record conflicts with an existing record') {
    super(message);
    this.name = 'StoreConflictError';
  }
}

export class StoreValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreValidationError';
  }
}
