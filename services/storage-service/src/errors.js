export class StorageError extends Error {
  constructor(status, message, code = 'STORAGE_ERROR', errors = []) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export class IntegrityError extends StorageError {
  constructor(message = 'The encrypted object failed integrity verification.') {
    super(422, message, 'INTEGRITY_CHECK_FAILED');
    this.name = 'IntegrityError';
  }
}
