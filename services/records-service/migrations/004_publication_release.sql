CREATE TABLE IF NOT EXISTS publication_receipt (
  receipt_id CHAR(36) PRIMARY KEY,
  receipt_type VARCHAR(32) NOT NULL,
  result_version_id CHAR(36) NOT NULL,
  outbox_id CHAR(36) NOT NULL,
  opaque_record_id CHAR(36) NOT NULL,
  version_number INT NOT NULL,
  ciphertext_hash CHAR(64) NULL,
  protected_object_reference VARCHAR(255) NULL,
  transaction_id VARCHAR(255) NULL,
  verification_token VARCHAR(255) NULL,
  raw_receipt JSON NOT NULL,
  received_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_publication_receipt_event_type (outbox_id, receipt_type),
  CONSTRAINT fk_publication_receipt_version FOREIGN KEY (result_version_id) REFERENCES result_version(result_version_id) ON DELETE RESTRICT,
  KEY idx_publication_receipt_record (opaque_record_id, version_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS result_release (
  release_id CHAR(36) PRIMARY KEY,
  result_version_id CHAR(36) NOT NULL UNIQUE,
  report_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  released_by CHAR(36) NOT NULL,
  released_at DATETIME(6) NOT NULL,
  ledger_receipt_id CHAR(36) NOT NULL,
  verification_token VARCHAR(255) NULL,
  CONSTRAINT fk_release_version FOREIGN KEY (result_version_id) REFERENCES result_version(result_version_id) ON DELETE RESTRICT,
  CONSTRAINT fk_release_report FOREIGN KEY (report_id) REFERENCES lab_report(report_id) ON DELETE RESTRICT,
  CONSTRAINT fk_release_order FOREIGN KEY (order_id) REFERENCES lab_order(order_id) ON DELETE RESTRICT,
  CONSTRAINT fk_release_receipt FOREIGN KEY (ledger_receipt_id) REFERENCES publication_receipt(receipt_id) ON DELETE RESTRICT,
  KEY idx_release_order (order_id, released_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS doctor_review (
  doctor_review_id CHAR(36) PRIMARY KEY,
  release_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  result_version_id CHAR(36) NOT NULL,
  doctor_auth_user_id CHAR(36) NOT NULL,
  review_note TEXT NOT NULL,
  reviewed_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_doctor_review_release_doctor (release_id, doctor_auth_user_id),
  CONSTRAINT fk_doctor_review_release FOREIGN KEY (release_id) REFERENCES result_release(release_id) ON DELETE RESTRICT,
  CONSTRAINT fk_doctor_review_order FOREIGN KEY (order_id) REFERENCES lab_order(order_id) ON DELETE RESTRICT,
  CONSTRAINT fk_doctor_review_version FOREIGN KEY (result_version_id) REFERENCES result_version(result_version_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS email_log (
  email_log_id CHAR(36) PRIMARY KEY,
  report_id CHAR(36) NULL,
  patient_id CHAR(36) NULL,
  recipient_email VARCHAR(254) NOT NULL,
  subject VARCHAR(180) NULL,
  message TEXT NULL,
  status VARCHAR(16) NOT NULL,
  provider_message_id VARCHAR(255) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  sent_at DATETIME(6) NULL,
  error_message TEXT NULL,
  CONSTRAINT fk_email_log_report FOREIGN KEY (report_id) REFERENCES lab_report(report_id) ON DELETE RESTRICT,
  CONSTRAINT fk_email_log_patient FOREIGN KEY (patient_id) REFERENCES patient(patient_id) ON DELETE RESTRICT,
  CONSTRAINT chk_email_status CHECK (status IN ('Pending','Sent','Failed')),
  KEY idx_email_status (status, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS print_log (
  print_log_id CHAR(36) PRIMARY KEY,
  report_id CHAR(36) NOT NULL,
  printed_by CHAR(36) NOT NULL,
  printed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  print_count INT NOT NULL DEFAULT 1,
  CONSTRAINT fk_print_log_report FOREIGN KEY (report_id) REFERENCES lab_report(report_id) ON DELETE RESTRICT,
  CONSTRAINT fk_print_log_staff FOREIGN KEY (printed_by) REFERENCES staff(staff_id) ON DELETE RESTRICT,
  CONSTRAINT chk_print_count CHECK (print_count > 0),
  KEY idx_print_report_time (report_id, printed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS attachment (
  attachment_id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NULL,
  report_id CHAR(36) NULL,
  file_name VARCHAR(180) NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  file_type VARCHAR(80) NULL,
  file_size BIGINT NULL,
  checksum_sha256 CHAR(64) NULL,
  uploaded_by CHAR(36) NULL,
  uploaded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_attachment_order FOREIGN KEY (order_id) REFERENCES lab_order(order_id) ON DELETE RESTRICT,
  CONSTRAINT fk_attachment_report FOREIGN KEY (report_id) REFERENCES lab_report(report_id) ON DELETE RESTRICT,
  CONSTRAINT fk_attachment_staff FOREIGN KEY (uploaded_by) REFERENCES staff(staff_id) ON DELETE SET NULL,
  CONSTRAINT chk_attachment_parent CHECK (order_id IS NOT NULL OR report_id IS NOT NULL),
  KEY idx_attachment_order (order_id),
  KEY idx_attachment_report (report_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
