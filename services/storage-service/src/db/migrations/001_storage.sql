CREATE TABLE IF NOT EXISTS encrypted_objects (
  id CHAR(36) PRIMARY KEY,
  record_id VARCHAR(128) NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_encrypted_objects_updated_at (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS encrypted_object_versions (
  id CHAR(36) PRIMARY KEY,
  record_id VARCHAR(128) NOT NULL,
  record_version INT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  request_fingerprint CHAR(64) NOT NULL,
  object_reference VARCHAR(255) NOT NULL,
  object_provider VARCHAR(32) NOT NULL,
  envelope_hash CHAR(64) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  algorithm VARCHAR(32) NOT NULL,
  key_reference VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_object_version_record FOREIGN KEY (record_id) REFERENCES encrypted_objects(record_id),
  UNIQUE KEY uq_record_version (record_id, record_version),
  INDEX idx_object_versions_hash (envelope_hash)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS storage_jobs (
  id CHAR(36) PRIMARY KEY,
  job_type VARCHAR(32) NOT NULL,
  record_id VARCHAR(128) NOT NULL,
  record_version INT UNSIGNED NOT NULL,
  status ENUM('PENDING','PROCESSING','RETRY_WAIT','SUCCEEDED','FAILED_REVIEW') NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  INDEX idx_storage_jobs_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS storage_receipts (
  id CHAR(36) PRIMARY KEY,
  job_id CHAR(36) NOT NULL UNIQUE,
  encrypted_object_version_id CHAR(36) NOT NULL,
  envelope_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_storage_receipt_job FOREIGN KEY (job_id) REFERENCES storage_jobs(id),
  CONSTRAINT fk_storage_receipt_version FOREIGN KEY (encrypted_object_version_id) REFERENCES encrypted_object_versions(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS retrieval_audit (
  id CHAR(36) PRIMARY KEY,
  record_id VARCHAR(128) NOT NULL,
  record_version INT UNSIGNED NOT NULL,
  caller_service VARCHAR(80) NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  outcome ENUM('SUCCEEDED','VERIFIED','FAILED') NOT NULL,
  failure_code VARCHAR(64) NULL,
  occurred_at DATETIME(3) NOT NULL,
  INDEX idx_retrieval_audit_record (record_id, record_version, occurred_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS encryption_key_references (
  id CHAR(36) PRIMARY KEY,
  key_reference VARCHAR(64) NOT NULL UNIQUE,
  algorithm VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;
