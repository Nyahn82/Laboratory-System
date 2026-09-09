# RHU LabChain Hybrid Laboratory Record System

RHU LabChain is a local Phase One academic prototype for a Rural Health Unit laboratory. It follows a synthetic patient from registration, doctor consultation and signed request through specimen handling, testing, QC, supervisor approval, encrypted storage, integrity registration, release, doctor review, patient access, and redacted QR verification.

> **Safety boundary:** use only synthetic or formally de-identified records. This repository is not approved for real patient processing, production clinical care, automated diagnosis, prescribing, or treatment recommendations.

## What is included

- React/Vite role-aware web application with an accessible healthcare-oriented neumorphic design.
- Four independently deployable Node.js/Express services: Authentication, Records & Sync, Encrypted Storage, and Verification.
- MySQL ownership boundaries, migrations, indexes, constraints, and synthetic seeds.
- AES-256-GCM record packaging with a new data key/nonce per immutable version.
- Private Kubo configuration that removes public bootstrap peers and stores encrypted envelopes only.
- Hyperledger Fabric integration path for two organizations/peers, one orderer, `labrecords`, and `labrecord-contract`.
- Explicit file-backed development adapters so Node-only work can proceed before Docker/Fabric is installed; the UI and readiness endpoints label these adapters as simulated.
- JWT access tokens, rotating opaque refresh tokens, RBAC, idempotency, outbox/retry, audit history, IndexedDB drafts, OpenAPI/Swagger, unit/integration tests, and Playwright E2E coverage.
- Safe backup verification and non-overwriting recovery staging scripts.

## Architecture

```text
Browser -> Nginx :8080 -> React web
                  |-> Authentication Service -> auth_db
                  |-> Records & Sync Service -> records_db
                  |-> Encrypted Storage ------> storage_db + private IPFS
                  `-> Verification -----------> verification_db + Fabric Gateway
                                                        |
                                     peer0.rhu.local -- orderer -- peer0.verifier.local
```

Each service owns its data and communicates through authenticated APIs or durable events. No service directly queries another service database. See [Architecture](docs/ARCHITECTURE.md) and [Database Design](docs/DATABASE.md).

## Windows requirements

### 1. Install Git

Download Git for Windows from <https://git-scm.com/download/win>. Accept the option that makes Git available from PowerShell. Verify:

```powershell
git --version
```

### 2. Install Node.js LTS

Install the current Node.js 24 LTS release from <https://nodejs.org/en/download>. This project declares Node 24 because it is the active LTS line used by the Docker images.

```powershell
node --version
npm --version
```

### 3. Enable WSL2

Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

Restart Windows when requested, complete the Linux distribution setup, then verify:

```powershell
wsl --status
```

Microsoft's current instructions are at <https://learn.microsoft.com/windows/wsl/install>.

### 4. Install Docker Desktop

Install Docker Desktop from <https://docs.docker.com/desktop/setup/install/windows-install/>. During setup, select the WSL2 backend. Open Docker Desktop, wait for the engine to report ready, then verify:

```powershell
docker --version
docker compose version
```

Allocate enough resources for MySQL, Kubo, and the optional Fabric peers; 8 GB RAM available to Docker is a practical development baseline.

## First-time environment setup

From PowerShell in this repository:

```powershell
npm install
npm run setup
```

`npm run setup` copies `.env.example` to the ignored `.env` and generates random local JWT, service, QR, storage, MySQL, and seed-password values. It never overwrites an existing `.env`.

Review `.env`. For this one-computer prototype, retain:

```text
PUBLIC_BASE_URL=http://localhost:8080
DB_DRIVER=file
OBJECT_STORE_DRIVER=filesystem
LEDGER_DRIVER=file
```

`NATIVE_PUBLIC_BASE_URL=http://localhost:5173` keeps locally generated verification links on Vite; Docker continues to use `PUBLIC_BASE_URL=http://localhost:8080`.

Never commit `.env`. Never reuse its values in a shared or production environment.

## Start without Docker (fast native development)

This is the current development mode: finish registration and the simulated system workflow before connecting real blockchain infrastructure. Payment is deferred; signed requests go directly to specimen accession. Docker, Kubo, and Fabric are not required.

```powershell
npm run dev:local
```

Open <http://localhost:5173>. Vite proxies the same `/api/*` paths used by Nginx. Native service data is stored under the ignored `data/` directory. The object store and ledger are simulations and are visibly labeled.

Stop all native processes with `Ctrl+C` in the terminal that started them.

## Start with Docker Desktop

Base Docker mode uses real MySQL and a private Kubo node. Verification deliberately retains the labeled file-ledger adapter until the Fabric network is bootstrapped.

```powershell
docker compose config --quiet
docker compose up --build
```

Open <http://localhost:8080>. To run in the background, add `-d`.

Stop without deleting data:

```powershell
docker compose down
```

Do not add `-v` unless you explicitly intend to delete database/object volumes and already have a verified backup.

## Database initialization and migrations

On the first Docker start, `infrastructure/mysql/init/01-create-schemas.sh` creates four databases and least-privilege users. Each service owns its migrations.

Native or host-accessible MySQL:

```powershell
npm run migrate
```

Docker, if a migration must be run manually:

```powershell
docker compose run --rm auth-service npm run migrate
docker compose run --rm records-service npm run migrate
docker compose run --rm storage-service npm run migrate
docker compose run --rm verification-service npm run migrate
```

Migrations are designed to be idempotent through their migration tracking tables. Back up before applying migrations to data you care about.

## Create the first administrator and development users

The idempotent authentication seed requires the private `DEV_SEED_PASSWORD` from `.env` and creates one forced-password-change account for each role:

| Role | Default email when `DEV_SEED_EMAIL_DOMAIN=lab.local` |
|---|---|
| System Administrator | `admin@lab.local` |
| Registration | `cashier@lab.local` |
| Doctor | `doctor@lab.local` |
| Laboratory Staff | `labstaff@lab.local` |
| Laboratory Supervisor | `supervisor@lab.local` |
| Patient | `patient@lab.local` |
| Public Verifier | `verifier@lab.local` |

Run:

```powershell
npm run seed
```

For Docker:

```powershell
docker compose run --rm -e ALLOW_PRODUCTION_SEED=true auth-service npm run seed
```

The seed password is never printed by the application. A local administrator can inspect their private `.env`:

```powershell
Get-Content -LiteralPath .env | Select-String '^DEV_SEED_PASSWORD='
```

Sign in and choose a unique password of at least 12 characters. Seed accounts cannot use normal protected workflows until the password is changed. Seeding is blocked in production unless deliberately overridden.

## Administration

Administrators land on **Accounts**. Select an account name to view its information, account access trail (sign-ins, password changes, and administrative changes), and laboratory activity. Both trails are paginated and restricted to authorized roles.

**Nodes** shows the ledger query result and separate health checks for the RHU peer, verifier peer, and orderer, with a check timestamp and refresh action. Native development shows the simulated ledger and disconnected nodes. With the Fabric stack connected, checks use the existing internal operations `/healthz` endpoints on port 9443. These checks do not prove peer synchronization or transaction consensus.

For a custom Fabric deployment, the Verification Service accepts `FABRIC_RHU_OPERATIONS_URL`, `FABRIC_VERIFIER_OPERATIONS_URL`, and `FABRIC_ORDERER_OPERATIONS_URL`. `AUTH_SERVICE_URL` must point to the Authentication Service so node monitoring can validate the current administrator account. The Docker configuration sets this automatically; operations ports remain internal.

## Development URLs

### Docker gateway

- Application: <http://localhost:8080>
- Public verification pattern: `http://localhost:8080/verify/<opaque-token>`
- Auth Swagger: <http://localhost:8080/api/auth/docs>
- Records Swagger: <http://localhost:8080/api/records/docs>
- Storage Swagger: <http://localhost:8080/api/storage/docs>
- Verification Swagger: <http://localhost:8080/api/verification/docs>

### Native development

- React/Vite: <http://localhost:5173>
- Authentication: <http://localhost:3001>
- Records & Sync: <http://localhost:3002>
- Encrypted Storage: <http://localhost:3003>
- Verification: <http://localhost:3004>

Each service exposes `/health`, `/ready`, `/docs`, and `/openapi.json` on its own port.

## Private IPFS status

The Kubo API is intentionally not exposed through Nginx or a host port. Check it inside Docker:

```powershell
docker compose exec ipfs ipfs id
docker compose exec ipfs ipfs bootstrap list
```

The bootstrap list should be empty. Inspect only synthetic encrypted objects. Never manually add plaintext patient JSON or reports.

## Start the real Fabric network

The base stack's file ledger is a simulation, not Hyperledger Fabric. Read [Blockchain and Verification](docs/BLOCKCHAIN.md), then run the guarded PowerShell bootstrap. It generates ignored local identities/channel material, starts the orderer and peers, deploys the chaincode, and switches Verification Service to Fabric:

```powershell
.\blockchain\fabric-network\Start-Fabric.ps1
Invoke-RestMethod http://localhost:8080/api/verification/ready
```

Verification `/ready` must report `fabric` and `simulated: false`; otherwise the UI correctly continues to show a simulated ledger warning. Stop Fabric safely and return to the labeled file adapter with `.\blockchain\fabric-network\Stop-Fabric.ps1`.

## Run builds and tests

```powershell
npm run build
npm test
npm run validate:infra
node scripts/security-check.mjs
```

Run the complete E2E only against an already running stack:

```powershell
npm run seed # development only; restores the forced-change seed accounts
$env:E2E_BASE_URL = "http://localhost:8080"
$env:DEV_SEED_PASSWORD = "<private value from .env>"
$env:E2E_ACCOUNT_PASSWORD = "<new unique test-only password>"
npm run test:e2e
```

See [Testing](docs/TESTING.md). A skipped infrastructure test is not a pass; record it as **Not Run**.

## Backup and recovery

Create and verify a backup inside the workspace:

```powershell
.\infrastructure\backup\Backup-LabChain.ps1
.\infrastructure\backup\Verify-Backup.ps1 -BackupDirectory .\backups\labchain-<timestamp>
```

The backup script exports all four MySQL databases, the encrypted IPFS repository, configuration copies, and SHA-256 manifest. It intentionally excludes `.env` and key material; protect those using an approved separate secret escrow.

Restore is staged into new database names and a new IPFS volume so active data is not overwritten:

```powershell
.\infrastructure\backup\Restore-LabChain.ps1 `
  -BackupDirectory .\backups\labchain-<timestamp> `
  -RecoverySuffix test01 `
  -ConfirmRestore
```

Verify a known synthetic released record, ciphertext hash/decryption, public proof, patient isolation, and doctor review before switching any service to staged recovery data. Fabric requires coordinated CA/peer/orderer/channel recovery; a database/IPFS restore alone is incomplete.

## Common troubleshooting

### `docker` is not recognized

Install/start Docker Desktop, enable WSL2 integration, close and reopen PowerShell, then run `docker version`. Docker is not installed or not on PATH when this error appears.

### WSL says it is not installed

Run `wsl --install` as Administrator and restart Windows. Confirm virtualization is enabled in firmware if installation fails.

### Port 8080 or 5173 is in use

Find the conflicting process:

```powershell
Get-NetTCPConnection -LocalPort 8080,5173 -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess
```

Stop only the process you recognize, or change the host/Vite port. Do not expose internal MySQL, Kubo, or Fabric ports to all interfaces.

### A service is healthy but not ready

`/health` checks the process. `/ready` checks its configured adapter/dependencies. Review `docker compose logs <service>`, MySQL/Kubo health, environment names, and Fabric identity paths. Do not replace readiness with a fake success.

### Login succeeds but screens are blocked

Seed accounts must change their password. Visit `/password-change`. Role restrictions are intentional; administrators have no automatic clinical access.

### Approval succeeds but release is blocked

Inspect Records outbox, Storage readiness, Verification readiness, and matching storage/ledger receipts. Release requires the exact immutable version to be stored and registered.

### QR page reveals more than status/proof metadata

Stop using the build and treat it as a high-severity privacy defect. The public response must not include a patient name/code, address, contact data, test names/values, notes, CID, keys, or raw token.

## Documentation map

- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Database](docs/DATABASE.md)
- [Security](docs/SECURITY.md)
- [Blockchain](docs/BLOCKCHAIN.md)
- [Offline Sync](docs/OFFLINE_SYNC.md)
- [Testing](docs/TESTING.md)
- [Exact source file manifest](docs/FILE_MANIFEST.md)

## Current Phase One limitations

- The file object-store and ledger adapters are development simulations.
- A real Fabric network requires generated local crypto material and the documented bootstrap; it is not silently created with committed keys.
- The Phase One Records MySQL adapter persists its authoritative workflow state as a transactionally locked JSON document while the normalized workbook-derived tables remain the next persistence-hardening target.
- MFA is a foundation rather than a production enrollment/recovery system.
- Email/PDF/print integrations are audit-ready foundations and may remain local/simulated.
- This project has not received institutional privacy, security, clinical, legal, or regulatory approval.

Current priority: finish patient registration and validate the complete local simulation without payments. Real infrastructure work is deferred until the simulated system is complete. The existing `cashier@lab.local` account now opens Registration; its internal role code remains `REGISTRATION_CASHIER` for compatibility. Select **Register patient**, then **Use sample patient** to populate a synthetic registration quickly.
