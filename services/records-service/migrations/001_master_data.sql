CREATE TABLE IF NOT EXISTS facility_profile (
  facility_id CHAR(36) PRIMARY KEY,
  facility_name VARCHAR(150) NOT NULL,
  facility_type VARCHAR(80) NULL,
  address TEXT NULL,
  contact_number VARCHAR(30) NULL,
  email VARCHAR(254) NULL,
  website VARCHAR(150) NULL,
  logo_path VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS staff (
  staff_id CHAR(36) PRIMARY KEY,
  auth_user_id CHAR(36) NULL,
  staff_code VARCHAR(20) NOT NULL UNIQUE,
  first_name VARCHAR(60) NOT NULL,
  middle_name VARCHAR(60) NULL,
  last_name VARCHAR(60) NOT NULL,
  role VARCHAR(32) NOT NULL,
  license_number VARCHAR(50) NULL,
  contact_number VARCHAR(30) NULL,
  email VARCHAR(254) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_staff_auth_user (auth_user_id),
  CONSTRAINT chk_staff_role CHECK (role IN ('Admin','Encoder','MedTech','Pathologist','Doctor','Nurse'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS requesting_physician (
  physician_id CHAR(36) PRIMARY KEY,
  auth_user_id CHAR(36) NULL,
  full_name VARCHAR(150) NOT NULL,
  license_number VARCHAR(50) NULL,
  specialization VARCHAR(100) NULL,
  clinic_name VARCHAR(150) NULL,
  contact_number VARCHAR(30) NULL,
  UNIQUE KEY uq_requesting_physician_auth_user (auth_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sample_type (
  sample_type_id CHAR(36) PRIMARY KEY,
  sample_name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS test_panel (
  panel_id CHAR(36) PRIMARY KEY,
  panel_code VARCHAR(30) NOT NULL UNIQUE,
  panel_name VARCHAR(120) NOT NULL,
  department VARCHAR(80) NULL,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS test_catalog (
  test_id CHAR(36) PRIMARY KEY,
  test_code VARCHAR(30) NOT NULL UNIQUE,
  test_name VARCHAR(150) NOT NULL,
  default_unit VARCHAR(50) NULL,
  sample_type_id CHAR(36) NULL,
  methodology VARCHAR(150) NULL,
  sort_order INT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_test_catalog_sample_type FOREIGN KEY (sample_type_id) REFERENCES sample_type(sample_type_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS panel_test (
  panel_test_id CHAR(36) PRIMARY KEY,
  panel_id CHAR(36) NOT NULL,
  test_id CHAR(36) NOT NULL,
  sort_order INT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_panel_test (panel_id, test_id),
  CONSTRAINT fk_panel_test_panel FOREIGN KEY (panel_id) REFERENCES test_panel(panel_id) ON DELETE CASCADE,
  CONSTRAINT fk_panel_test_test FOREIGN KEY (test_id) REFERENCES test_catalog(test_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS reference_range (
  range_id CHAR(36) PRIMARY KEY,
  test_id CHAR(36) NOT NULL,
  sex VARCHAR(8) NOT NULL,
  age_min DECIMAL(7,2) NULL,
  age_max DECIMAL(7,2) NULL,
  age_unit VARCHAR(16) NOT NULL DEFAULT 'years',
  normal_low DECIMAL(18,6) NULL,
  normal_high DECIMAL(18,6) NULL,
  unit VARCHAR(50) NULL,
  critical_low DECIMAL(18,6) NULL,
  critical_high DECIMAL(18,6) NULL,
  interpretation_note TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_reference_range_test FOREIGN KEY (test_id) REFERENCES test_catalog(test_id) ON DELETE RESTRICT,
  CONSTRAINT chk_reference_range_sex CHECK (sex IN ('M','F','Any')),
  CONSTRAINT chk_reference_range_age CHECK (age_min IS NULL OR age_max IS NULL OR age_min <= age_max),
  CONSTRAINT chk_reference_range_normal CHECK (normal_low IS NULL OR normal_high IS NULL OR normal_low <= normal_high),
  CONSTRAINT chk_reference_range_critical_low CHECK (critical_low IS NULL OR normal_low IS NULL OR critical_low <= normal_low),
  CONSTRAINT chk_reference_range_critical_high CHECK (critical_high IS NULL OR normal_high IS NULL OR critical_high >= normal_high),
  KEY idx_reference_range_match (test_id, is_active, sex, age_min, age_max)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS report_template (
  template_id CHAR(36) PRIMARY KEY,
  template_name VARCHAR(100) NOT NULL,
  panel_id CHAR(36) NOT NULL,
  header_title VARCHAR(150) NULL,
  section_title VARCHAR(150) NULL,
  footer_note TEXT NULL,
  medico_legal_note TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_report_template_panel FOREIGN KEY (panel_id) REFERENCES test_panel(panel_id) ON DELETE RESTRICT,
  KEY idx_report_template_panel_active (panel_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS signatory (
  signatory_id CHAR(36) PRIMARY KEY,
  staff_id CHAR(36) NOT NULL,
  signatory_type VARCHAR(32) NOT NULL,
  signature_image_path VARCHAR(255) NULL,
  license_number VARCHAR(50) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_signatory_staff FOREIGN KEY (staff_id) REFERENCES staff(staff_id) ON DELETE RESTRICT,
  CONSTRAINT chk_signatory_type CHECK (signatory_type IN ('Lab In-Charge','Medical Technologist','Pathologist')),
  KEY idx_signatory_active_type (is_active, signatory_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
