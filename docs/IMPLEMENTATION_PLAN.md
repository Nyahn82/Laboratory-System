# RHU LabChain Phase One Implementation Plan

## Objective

Deliver a local academic prototype that proves the complete synthetic-patient laboratory journey on one Windows computer. The implementation follows the supplied Phase One blueprint and entity workbook while treating both as references. It is not authorized for real patient care or automated diagnosis.

## Current priority

Complete patient registration first, then validate the full local simulation. Payments and real blockchain deployment are deferred. New requests proceed directly to accession; existing payment-classified requests remain usable. Keep the `REGISTRATION_CASHIER` role code and existing accounts for compatibility, with the workspace labeled Registration.

## Architecture decisions

- One React/Vite application provides role-specific portals behind one Nginx entry point.
- Exactly four independently deployable Express services own identity, clinical/laboratory workflow, encrypted storage, and blockchain verification.
- Docker mode uses four isolated MySQL databases, a private Kubo node, and an optional real Hyperledger Fabric profile with two peers, one orderer, the `labrecords` channel, and `labrecord-contract` chaincode.
- Native Windows development uses explicit file adapters (`DB_DRIVER=file`, `OBJECT_STORE_DRIVER=filesystem`, `LEDGER_DRIVER=file`). Health/readiness responses and the UI label these adapters as simulated. They never masquerade as MySQL, IPFS, or Fabric.
- Cross-service calls use authenticated HTTP. No service reads another service's schema.
- Released result versions are canonicalized, encrypted with AES-256-GCM, hashed as ciphertext, stored, registered, and then released. Corrections append a new immutable version.

## Delivery sequence

1. Establish workspaces, environment generation, shared HTTP/security utilities, Docker topology, and Nginx routes.
2. Implement Identity and Access with password hashing, access tokens, rotating refresh tokens, roles, permissions, sessions, forced seed-password changes, and audit events.
3. Implement patients, visits, consultations, signed orders, catalog/panels, specimens, testing, QC, repeat/referral branches, approval, release, doctor review, audit, and sync outbox.
4. Implement canonical record encryption/decryption and IPFS/filesystem adapters with hash verification and key references outside record stores.
5. Implement redacted QR verification and explicit file/Fabric ledger adapters plus chaincode and network configuration.
6. Connect role-aware React screens, IndexedDB drafts/outbox, status indicators, report/QR views, audit/health/backup screens, and accessible neumorphic styling.
7. Add migrations, synthetic seed data, safe backup/restore scripts, OpenAPI documents, and Windows-first operating documentation.
8. Run builds and unit/integration tests locally. Validate Compose statically when Docker is unavailable, and record real-runtime limitations honestly.

## Phase One acceptance checks

- Registration -> consultation -> order -> specimen -> testing -> QC -> submission -> approval -> encrypted storage -> proof registration -> release -> doctor review -> patient access -> public redacted verification works with synthetic data.
- Invalid state transitions, duplicate idempotency keys, cross-role edits, cross-patient access, refresh-token reuse, QC failure, and ciphertext tampering are rejected and audited.
- Every service exposes `/health`, `/ready`, and Swagger/OpenAPI documentation.
- Public verification exposes no patient identity, address, clinical notes, or laboratory values.
- No plaintext record is submitted to IPFS or Fabric; only opaque record metadata and ciphertext proof are registered.
- All generated secrets remain in ignored `.env` or external runtime mounts.

## Known environment constraint

The current workstation has Node.js and npm but does not presently expose Docker Desktop, WSL2, MySQL, Kubo, or Fabric binaries. Node builds/tests can be completed here. Container, peer, and recovery drills require the documented Windows prerequisites.
