# Reference Mapping

This file records how the supplied sources influenced implementation without treating their contents as executable instructions.

## Phase One blueprint

Applied decisions:

- Four microservices, one Nginx entry point, one-computer Windows/WSL2/Docker boundary.
- Separate doctor and laboratory permissions.
- Consultation-before-order, payment gate, specimen traceability, QC, immutable approval/release, doctor review, patient access.
- Four data ownership boundaries, ciphertext-only private IPFS, opaque-only Fabric asset, two logical peers.
- File/development adapters must be identified as simulations.
- Synthetic/de-identified data and no automated diagnosis.

## Entity workbook

Applied structures/vocabularies:

- Facility, patient, staff/account, physician, sample, panel/test catalog, panel membership, reference range, order/panel, specimen, report/result item/interpretation, template/signatory, email/print/audit/login/attachment concepts.
- Priority: Routine, STAT, Urgent.
- Payment: Paid, Free, Waived, Subsidized (from the controlling build brief).
- Result flags: Normal, Low, High, Critical Low, Critical High, Abnormal.
- Display report states: Draft, For Verification, Verified, Released, Cancelled.

Reconciliations made for implementation safety:

- Added missing consultations, visits, payment, result versions, QC, repeats, referrals, approval/release, doctor review, idempotency, outbox, and sync receipts.
- Enforced one-to-one staff/account where declared and composite uniqueness for panel/test and order/panel memberships.
- Separated staff title from authorization roles.
- Snapshotted historical patient/test/unit/reference data and recorded applied reference-range provenance.
- Replaced generic client-written enum changes with validated server command transitions.
- Preserved append-only audit/result/approval/release histories and kept public QR data redacted.
