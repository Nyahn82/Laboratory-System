# Security Model

## Data classification

Patient identity, consultations, laboratory values, reference interpretations, and decrypted records are sensitive clinical data. Passwords, tokens, wrapping keys, Fabric identities, and private-network material are secrets. Public verification fields are deliberately non-clinical and opaque.

Only synthetic or formally de-identified data is permitted in this Phase One prototype.

## Authentication

- Bcrypt password hashing.
- Short-lived HS256 access JWTs carrying user ID, roles, permissions, optional linked patient ID, and forced-password-change state.
- Opaque random refresh tokens stored only as SHA-256 digests.
- Refresh-token rotation; reuse revokes the complete token family.
- HttpOnly, SameSite=Strict refresh cookie for the browser.
- Login rate limiting, failed-attempt records, account activation/deactivation/locking foundation.
- Seed accounts must change their generated development password before other protected actions.
- MFA tables/claims provide a Phase One foundation; production-grade MFA enrollment and recovery remain a documented limitation.

## Authorization

Authorization is enforced server-side on every protected route. A frontend route is only a usability measure.

- Administrators do not receive implicit patient/result access.
- Doctors are limited to assigned/requesting-doctor relationships and cannot mutate measured values, QC, approval, storage, or ledger receipts.
- Laboratory staff cannot change consultation notes or approve their own submitted result through a role bypass.
- Supervisors approve/reject/release but cannot erase history.
- Patients see only released records linked to their authenticated account.
- Public callers receive only redacted verification status.

Denied access should not reveal whether an unrelated patient or record exists.

## Encryption and integrity

1. The finalized result version is deterministically serialized.
2. A fresh 32-byte data-encryption key and 12-byte nonce are generated per version.
3. AES-256-GCM produces authenticated ciphertext and tag.
4. The data key is wrapped using the external master key from `STORAGE_MASTER_KEY_BASE64`.
5. SHA-256 is computed over the stored encrypted envelope.
6. Only the encrypted envelope is sent to private IPFS/filesystem storage.
7. Retrieval recomputes the hash before decryption; any mismatch or GCM failure blocks display and is audited.
8. The raw private-IPFS CID remains in Storage metadata; a keyed HMAC-derived opaque reference is the only object reference eligible for Fabric registration.

The master key is never placed in MySQL, IPFS, Fabric, logs, source, or QR codes.

## Ledger and QR privacy

Fabric accepts only opaque record ID, version, ciphertext hash, protected private CID reference, approval/release timestamps, issuing organization, status, and transaction metadata. Chaincode rejects prohibited patient/clinical field names.

QR codes contain only `${PUBLIC_BASE_URL}/verify/<opaque-token>`. The service persists a digest of the random token. Public responses exclude names, patient codes, addresses, contact data, clinical notes, laboratory values, CIDs, hashes usable as locators, tokens, and internal audit identities.

## HTTP and logging

Nginx and Express apply request-size limits, timeouts, security headers, validation, rate limiting, and correlation IDs. Error responses do not expose stack traces. Logs must not include passwords, access/refresh tokens, encryption keys, decrypted results, or complete patient payloads.

## Secret handling

Run `npm run setup` to create an ignored `.env` with random local secrets. Never commit `.env`, generated Fabric identities, private network keys, local data, or backups. Run `node scripts/security-check.mjs` before sharing the repository.

## Remaining security limitations

This prototype has not undergone institutional privacy review, penetration testing, production key-management/HSM integration, high-availability design, or clinical regulatory validation. File adapters and the single-PC Fabric network are development simulations.
