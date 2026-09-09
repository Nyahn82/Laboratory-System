CREATE TABLE IF NOT EXISTS audit_log (
  audit_id CHAR(36) PRIMARY KEY,
  staff_id CHAR(36) NULL,
  actor_user_id CHAR(36) NULL,
  actor_roles JSON NULL,
  action VARCHAR(100) NOT NULL,
  table_name VARCHAR(100) NOT NULL,
  record_id CHAR(36) NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  metadata JSON NULL,
  request_id VARCHAR(128) NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_audit_staff FOREIGN KEY (staff_id) REFERENCES staff(staff_id) ON DELETE SET NULL,
  KEY idx_audit_record (table_name, record_id, created_at),
  KEY idx_audit_actor (actor_user_id, created_at),
  KEY idx_audit_action_time (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS status_history (
  history_id CHAR(36) PRIMARY KEY,
  entity_type VARCHAR(40) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NOT NULL,
  display_status VARCHAR(40) NULL,
  reason TEXT NULL,
  actor_user_id CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_status_history_entity (entity_type, entity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS outbox_event (
  outbox_id CHAR(36) PRIMARY KEY,
  event_type VARCHAR(80) NOT NULL,
  aggregate_type VARCHAR(40) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  payload JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NOT NULL,
  last_error TEXT NULL,
  requested_by CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at DATETIME(6) NULL,
  CONSTRAINT chk_outbox_status CHECK (status IN ('PENDING','PROCESSING','COMPLETED','RETRY_WAIT','FAILED_REVIEW')),
  KEY idx_outbox_dispatch (status, next_attempt_at),
  KEY idx_outbox_aggregate (aggregate_type, aggregate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sync_operation (
  operation_id CHAR(36) PRIMARY KEY,
  device_id VARCHAR(128) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  base_revision BIGINT NOT NULL,
  action VARCHAR(16) NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(24) NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at DATETIME(6) NULL,
  received_at DATETIME(6) NOT NULL,
  CONSTRAINT chk_sync_operation_status CHECK (status IN ('PENDING','SYNCING','APPLIED','DUPLICATE','CONFLICT','RETRY_WAIT','FAILED_REVIEW')),
  KEY idx_sync_device_time (device_id, received_at),
  KEY idx_sync_status_retry (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sync_receipt (
  receipt_id CHAR(36) PRIMARY KEY,
  operation_id CHAR(36) NOT NULL UNIQUE,
  device_id VARCHAR(128) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL,
  message VARCHAR(500) NOT NULL,
  server_revision BIGINT NULL,
  received_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_sync_receipt_operation FOREIGN KEY (operation_id) REFERENCES sync_operation(operation_id) ON DELETE RESTRICT,
  KEY idx_sync_receipt_actor (actor_user_id, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS idempotency_record (
  idempotency_id CHAR(36) PRIMARY KEY,
  idempotency_key VARCHAR(128) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  scope VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  response_status INT NULL,
  response_body JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at DATETIME(6) NULL,
  UNIQUE KEY uq_idempotency_actor_scope_key (actor_user_id, scope, idempotency_key),
  CONSTRAINT chk_idempotency_status CHECK (status IN ('IN_PROGRESS','COMPLETED','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The state document is a transactional compatibility projection used by the current
-- repository adapter. The normalized tables above remain the migration contract and
-- allow future repository methods to move to row-level persistence without API changes.
CREATE TABLE IF NOT EXISTS records_service_state (
  state_id TINYINT PRIMARY KEY,
  state_json JSON NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
