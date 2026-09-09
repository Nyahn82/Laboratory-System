CREATE TABLE IF NOT EXISTS patient (
  patient_id CHAR(36) PRIMARY KEY,
  patient_code VARCHAR(20) NOT NULL UNIQUE,
  first_name VARCHAR(60) NOT NULL,
  middle_name VARCHAR(60) NULL,
  last_name VARCHAR(60) NOT NULL,
  suffix VARCHAR(20) NULL,
  birth_date DATE NULL,
  age_snapshot INT NULL,
  sex VARCHAR(8) NULL,
  civil_status VARCHAR(20) NULL,
  nationality VARCHAR(60) NULL,
  contact_number VARCHAR(30) NULL,
  email VARCHAR(254) NULL,
  address TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  CONSTRAINT chk_patient_sex CHECK (sex IS NULL OR sex IN ('M','F','Other')),
  KEY idx_patient_name (last_name, first_name),
  KEY idx_patient_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS patient_account_link (
  link_id CHAR(36) PRIMARY KEY,
  patient_id CHAR(36) NOT NULL,
  auth_user_id CHAR(36) NOT NULL,
  linked_by CHAR(36) NOT NULL,
  linked_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_patient_account_patient (patient_id),
  UNIQUE KEY uq_patient_account_user (auth_user_id),
  CONSTRAINT fk_patient_account_patient FOREIGN KEY (patient_id) REFERENCES patient(patient_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS visit (
  visit_id CHAR(36) PRIMARY KEY,
  visit_code VARCHAR(30) NOT NULL UNIQUE,
  patient_id CHAR(36) NOT NULL,
  visit_date DATETIME(6) NOT NULL,
  visit_type VARCHAR(24) NOT NULL,
  chief_complaint TEXT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  revision BIGINT NOT NULL DEFAULT 1,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL,
  CONSTRAINT fk_visit_patient FOREIGN KEY (patient_id) REFERENCES patient(patient_id) ON DELETE RESTRICT,
  KEY idx_visit_patient_date (patient_id, visit_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS consultation (
  consultation_id CHAR(36) PRIMARY KEY,
  visit_id CHAR(36) NOT NULL,
  patient_id CHAR(36) NOT NULL,
  physician_id CHAR(36) NULL,
  doctor_auth_user_id CHAR(36) NOT NULL,
  clinical_notes TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  signed_at DATETIME(6) NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL,
  CONSTRAINT fk_consultation_visit FOREIGN KEY (visit_id) REFERENCES visit(visit_id) ON DELETE RESTRICT,
  CONSTRAINT fk_consultation_patient FOREIGN KEY (patient_id) REFERENCES patient(patient_id) ON DELETE RESTRICT,
  CONSTRAINT fk_consultation_physician FOREIGN KEY (physician_id) REFERENCES requesting_physician(physician_id) ON DELETE SET NULL,
  CONSTRAINT chk_consultation_status CHECK (status IN ('DRAFT','COMPLETED')),
  KEY idx_consultation_doctor (doctor_auth_user_id, status),
  KEY idx_consultation_patient (patient_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS lab_order (
  order_id CHAR(36) PRIMARY KEY,
  opaque_record_id CHAR(36) NOT NULL UNIQUE,
  order_code VARCHAR(30) NOT NULL UNIQUE,
  consultation_id CHAR(36) NOT NULL,
  patient_id CHAR(36) NOT NULL,
  physician_id CHAR(36) NULL,
  doctor_auth_user_id CHAR(36) NOT NULL,
  ordered_by CHAR(36) NULL,
  order_date DATETIME(6) NOT NULL,
  priority VARCHAR(16) NOT NULL,
  clinical_notes TEXT NULL,
  diagnosis TEXT NULL,
  status VARCHAR(32) NOT NULL,
  display_status VARCHAR(32) NOT NULL,
  signed_at DATETIME(6) NOT NULL,
  correction_in_progress BOOLEAN NOT NULL DEFAULT FALSE,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL,
  CONSTRAINT fk_lab_order_consultation FOREIGN KEY (consultation_id) REFERENCES consultation(consultation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_lab_order_patient FOREIGN KEY (patient_id) REFERENCES patient(patient_id) ON DELETE RESTRICT,
  CONSTRAINT fk_lab_order_physician FOREIGN KEY (physician_id) REFERENCES requesting_physician(physician_id) ON DELETE SET NULL,
  CONSTRAINT fk_lab_order_ordered_by FOREIGN KEY (ordered_by) REFERENCES staff(staff_id) ON DELETE SET NULL,
  CONSTRAINT chk_lab_order_priority CHECK (priority IN ('Routine','STAT','Urgent')),
  CONSTRAINT chk_lab_order_status CHECK (status IN ('REQUESTED','PAYMENT_CLASSIFIED','ACCESSIONED','COLLECTED','IN_TESTING','FOR_VERIFICATION','APPROVED','STORAGE_PENDING','STORED','LEDGER_PENDING','LEDGER_REGISTERED','RELEASED','RECOLLECTION_REQUIRED','CANCELLED')),
  KEY idx_lab_order_patient_date (patient_id, order_date),
  KEY idx_lab_order_doctor_status (doctor_auth_user_id, status),
  KEY idx_lab_order_queue (status, priority, order_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS order_panel (
  order_panel_id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  panel_id CHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'Pending',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_order_panel (order_id, panel_id),
  CONSTRAINT fk_order_panel_order FOREIGN KEY (order_id) REFERENCES lab_order(order_id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_panel_panel FOREIGN KEY (panel_id) REFERENCES test_panel(panel_id) ON DELETE RESTRICT,
  CONSTRAINT chk_order_panel_status CHECK (status IN ('Pending','Processing','Completed','Cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS order_item (
  order_item_id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  panel_id CHAR(36) NULL,
  test_id CHAR(36) NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'REQUESTED',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_order_item_test (order_id, panel_id, test_id),
  CONSTRAINT fk_order_item_order FOREIGN KEY (order_id) REFERENCES lab_order(order_id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_item_panel FOREIGN KEY (panel_id) REFERENCES test_panel(panel_id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_item_test FOREIGN KEY (test_id) REFERENCES test_catalog(test_id) ON DELETE RESTRICT,
  KEY idx_order_item_order_status (order_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS payment_classification (
  payment_id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL UNIQUE,
  classification VARCHAR(16) NOT NULL,
  amount DECIMAL(12,2) NULL,
  receipt_number VARCHAR(80) NULL,
  authorization_code VARCHAR(80) NULL,
  subsidy_program VARCHAR(120) NULL,
  reason VARCHAR(500) NULL,
  classified_by CHAR(36) NOT NULL,
  classified_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES lab_order(order_id) ON DELETE RESTRICT,
  CONSTRAINT chk_payment_class CHECK (classification IN ('Paid','Free','Waived','Subsidized')),
  CONSTRAINT chk_payment_paid CHECK (classification <> 'Paid' OR (amount IS NOT NULL AND receipt_number IS NOT NULL)),
  CONSTRAINT chk_payment_reason CHECK (classification NOT IN ('Free','Waived') OR reason IS NOT NULL),
  CONSTRAINT chk_payment_subsidy CHECK (classification <> 'Subsidized' OR subsidy_program IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
