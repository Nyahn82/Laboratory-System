# Testing

## Fast local checks

Install dependencies once, then run all build and test workspaces:

```powershell
npm install
npm run build
npm test
npm run validate:infra
node scripts/security-check.mjs
```

Service tests use deterministic adapters and do not require MySQL, Kubo, or Fabric. They cover health/readiness, validation, authorization, domain transitions, encryption, and redaction.

## Required behavior coverage

- Login, forced password change, token refresh rotation/reuse rejection, logout, and role restrictions.
- Patient registration/account linking and cross-patient isolation.
- Consultation and signed laboratory request creation by a doctor.
- Payment-free accession from REQUESTED, disabled payment endpoints, and continued support for previously classified orders.
- Registration form submission, sample data, and offline retries using the original idempotency key.
- Unique accession and specimen collection/rejection/recollection history.
- Result entry/reference snapshots/flags, QC pass/fail, repeat and referral gates.
- Invalid workflow transitions and duplicate idempotency keys.
- Result submission, supervisor approval/rejection, release, and immutable correction versions.
- AES-256-GCM round trip, unique nonce, wrong key/tag/ciphertext tamper failure, hash verification.
- Patient own-record access, append-only doctor review, public QR redaction.
- All four `/health` and `/ready` endpoints.

## Complete Playwright flow

Start the native or Docker stack, set the generated development credentials, and run:

```powershell
npm run seed # development only; restores the forced-change seed accounts
$env:E2E_BASE_URL = "http://127.0.0.1:8080"
$env:DEV_SEED_PASSWORD = "<value from your private .env>"
$env:E2E_ACCOUNT_PASSWORD = "<new unique test-only password>"
npm run test:e2e
```

`tests/e2e/specs/full-laboratory-flow.spec.js` performs the complete registration-to-public-verification journey with synthetic data. It is skipped unless `E2E_BASE_URL` is explicitly set, so a normal unit-test run does not claim infrastructure was exercised.

## Docker/infrastructure checks

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://localhost:8080/api/auth/health
Invoke-RestMethod http://localhost:8080/api/records/health
Invoke-RestMethod http://localhost:8080/api/storage/health
Invoke-RestMethod http://localhost:8080/api/verification/health
```

Run adapter contract suites against real MySQL/private Kubo and then the Fabric overlay. Inspect a stored object to confirm it does not contain a patient name or result text. Modify one ciphertext byte and prove retrieval fails.

## Backup/recovery drill

1. Release and record the token/opaque ID of a known synthetic result.
2. Run the backup and checksum scripts.
3. Stage restoration using a unique recovery suffix; active data is not overwritten.
4. Point a clean recovery stack at the staged databases/object volume and coordinated Fabric backup.
5. Verify decryption, ciphertext proof, release history, doctor review, patient isolation, and redacted public response.

## Evidence

For formal Phase One release testing, record build version, synthetic test-data ID, expected/actual result, pass/fail, defect ID, resource usage when relevant, and retest result. Docker/Fabric tests that could not run must be marked **Not Run**, never inferred from static files.
