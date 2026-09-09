CREATE TABLE IF NOT EXISTS ledger_registrations (
  id CHAR(36) PRIMARY KEY,
  record_id VARCHAR(128) NOT NULL,
  record_version INT UNSIGNED NOT NULL,
  document_hash CHAR(64) NOT NULL,
  encrypted_cid_reference VARCHAR(512) NULL,
  approval_timestamp DATETIME(3) NOT NULL,
  issuing_organization VARCHAR(120) NOT NULL,
  status ENUM('REGISTERED','RELEASED','REVOKED') NOT NULL,
  registration_transaction_id VARCHAR(128) NOT NULL,
  release_transaction_id VARCHAR(128) NULL,
  release_timestamp DATETIME(3) NULL,
  revoke_transaction_id VARCHAR(128) NULL,
  revoked_at DATETIME(3) NULL,
  reason_code ENUM('CORRECTED','ISSUED_IN_ERROR','SECURITY','OTHER') NULL,
  registered_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_ledger_record_version (record_id, record_version),
  INDEX idx_ledger_status (status, registered_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ledger_registration_jobs (
  id CHAR(36) PRIMARY KEY,
  job_type ENUM('REGISTER','RELEASE','REVOKE') NOT NULL,
  record_id VARCHAR(128) NOT NULL,
  record_version INT UNSIGNED NOT NULL,
  status ENUM('PENDING','PROCESSING','RETRY_WAIT','SUCCEEDED','FAILED_REVIEW') NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  INDEX idx_ledger_jobs_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id CHAR(36) PRIMARY KEY,
  record_id VARCHAR(128) NOT NULL,
  record_version INT UNSIGNED NOT NULL,
  operation_type ENUM('REGISTER','RELEASE','REVOKE') NOT NULL,
  fabric_transaction_id VARCHAR(128) NOT NULL,
  ledger_provider VARCHAR(64) NOT NULL,
  simulated BOOLEAN NOT NULL,
  committed_at DATETIME(3) NOT NULL,
  INDEX idx_ledger_transactions_record (record_id, record_version, committed_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS verification_tokens (
  id CHAR(36) PRIMARY KEY,
  token_digest CHAR(64) NOT NULL UNIQUE,
  record_id VARCHAR(128) NOT NULL,
  record_version INT UNSIGNED NOT NULL,
  status ENUM('ACTIVE','REVOKED') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  INDEX idx_verification_token_record (record_id, record_version, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS verification_receipts (
  id CHAR(36) PRIMARY KEY,
  token_id CHAR(36) NULL,
  record_id VARCHAR(128) NULL,
  record_version INT UNSIGNED NULL,
  outcome ENUM('VALID','INVALID','NOT_FOUND','REVOKED','EXPIRED') NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  source VARCHAR(80) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  INDEX idx_verification_receipts_record (record_id, record_version, occurred_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS verification_idempotency (
  id CHAR(36) PRIMARY KEY,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  request_fingerprint CHAR(64) NOT NULL,
  operation_type ENUM('REGISTER','RELEASE','REVOKE') NOT NULL,
  response_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blockchain_sync_status (
  id CHAR(36) PRIMARY KEY,
  ledger_provider VARCHAR(64) NOT NULL,
  channel_name VARCHAR(64) NOT NULL,
  chaincode_name VARCHAR(128) NOT NULL,
  status ENUM('UNKNOWN','READY','DEGRADED','OFFLINE') NOT NULL,
  checked_at DATETIME(3) NOT NULL,
  details_json JSON NULL,
  INDEX idx_blockchain_sync_checked (checked_at)
) ENGINE=InnoDB;
