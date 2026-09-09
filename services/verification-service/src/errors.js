export class VerificationError extends Error {
  constructor(status, message, code = 'VERIFICATION_ERROR', errors = []) {
    super(message);
    this.name = 'VerificationError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}
