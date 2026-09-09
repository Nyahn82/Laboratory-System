# Database Design

## Ownership

Docker uses one MySQL 8.4 server with four databases and four restricted accounts:

- `auth_db` / `labchain_auth`
- `records_db` / `labchain_records`
- `storage_db` / `labchain_storage`
- `verification_db` / `labchain_verification`

There are no cross-database foreign keys or direct reads. Cross-service identifiers are opaque UUIDs carried through authenticated APIs and durable events.

## Authentication database

Core tables include `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `refresh_tokens`, `login_attempts`, `password_reset_tokens`, `user_sessions`, and authentication `audit_events`. Refresh tokens are stored only as SHA-256 digests. Passwords are bcrypt hashes.

## Records database

The supplied entity workbook informed the master and report structures:

- Facility/staff/catalog: `facility_profiles`, `staff_profiles`, `requesting_physicians`, `sample_types`, `test_panels`, `test_catalog`, `panel_tests`, `reference_ranges`, `report_templates`, `signatories`.
- Clinical workflow: `patients`, `patient_account_links`, `visits`, `consultations`, `laboratory_orders`, `laboratory_order_items`, `payment_records`, `specimens`, `specimen_events`.
- Result lifecycle: `test_results`, `result_versions`, `result_items`, `quality_control_checks`, `repeat_tests`, `referrals`, `approvals`, `releases`, `doctor_reviews`.
- Operations: `record_status_history`, `audit_logs`, `outbox_events`, `sync_receipts`, `idempotency_records`, `email_logs`, `print_logs`, and attachment metadata.

### Workbook reconciliation choices

- `USER_ACCOUNT.staff_id` is unique when a one-to-one staff/account relationship is used.
- `panel_tests(panel_id, test_id)` and `order_panels(order_id, panel_id)` are unique.
- Staff job title is separate from authorization roles.
- Age, name, sex, unit, test name, reference range, and applied-range provenance are snapshotted at the appropriate order/report/result version.
- Reference ranges have ordered thresholds and non-overlap rules. UTC timestamps are used everywhere.
- Result flags use the reference vocabulary: `Normal`, `Low`, `High`, `Critical Low`, `Critical High`, `Abnormal`.
- Internal statuses use stable machine codes; the UI may display workbook labels such as `For Verification`.

Approved/submitted result versions are never updated. Rejection or correction inserts a linked new version.

For the Phase One runnable prototype, the Records MySQL repository serializes the authoritative aggregate into `records_service_state` and locks that row for each transaction. The normalized workbook-derived tables and constraints are migrated and seeded as the target model, but moving runtime writes from the aggregate document into those tables is remaining persistence hardening rather than a claim of completion.

## Storage database

Tables include `encrypted_objects`, `encrypted_object_versions`, `wrapped_keys`, `storage_jobs`, `storage_receipts`, `retrieval_audit`, and `encryption_key_references`. Database rows contain ciphertext metadata and key references, not plaintext or the master wrapping key.

## Verification database

Tables include `ledger_registration_jobs`, `ledger_transactions`, `verification_tokens`, `verification_receipts`, `blockchain_sync_status`, and revocation/history records. Only token digests are persisted.

## Migrations and seeds

Each service owns its migration directory and migration script. From the repository root:

```powershell
npm run migrate
npm run seed
```

Seeds are synthetic and idempotent. `DEV_SEED_PASSWORD` is required; no seed password exists in source control. Seed accounts require a password change on first login.

## Deletion and retention

Clinical history, audit, approvals, releases, storage receipts, and ledger receipts are append-only. Catalogs and user accounts are deactivated rather than erased when history refers to them. Retention/destruction decisions require institutional policy and are not automated by this prototype.
