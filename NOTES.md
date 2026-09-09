# RHU LabChain account notes

Application: http://localhost:5173

Use the email address as the username when signing in.

All 9 accounts below were verified in the local account store on September 5, 2026. All are active.

| Username / email | Role |
| --- | --- |
| admin@lab.local | System Administrator |
| cashier@lab.local | Registration |
| doctor@lab.local | Doctor |
| labstaff@lab.local | Laboratory Staff |
| supervisor@lab.local | Laboratory Supervisor |
| patient@lab.local | Patient |
| verifier@lab.local | Public Verifier |
| e2e.patient.mtdkkx3t@lab.local | Patient (E2E test account) |
| e2e.patient.mtdl62kx@lab.local | Patient (E2E test account) |

The initial password for the seven default accounts is configured by `DEV_SEED_PASSWORD` in the local `.env` file. If an account's password has been changed, use its updated password. Accounts requiring a password change will prompt you after sign-in.

## Role workspaces

Each account opens an interface focused on its assigned role:

| Role | Workspace focus |
| --- | --- |
| System Administrator | Accounts, roles, service health, audit, sync, and backups |
| Registration | Patient registration, identity details, and request tracking |
| Doctor | Consultations, signed laboratory requests, and released result review |
| Laboratory Staff | Specimens, result entry, quality control, repeats/referrals, and submission |
| Laboratory Supervisor | Result review, approval, release, and workflow audit |
| Patient | Their own released reports, history, and verification QR |
| Public Verifier | Report authenticity checks using a verification link or token |

Accounts with multiple assigned roles can choose an active workspace in the sidebar. Navigation and actions follow that workspace. Refresh the application to load interface updates.

## Current development scope

Finish registration and the local system simulation first. Payment screens and endpoints are removed; requested orders go directly to specimen accession. Use `npm run dev:local` for file-backed storage and ledger simulation, without real blockchain nodes. The existing registration login is still `cashier@lab.local`. Use **Use sample patient** in the registration form to avoid inventing test details each time.

Registration now has two steps: **Patient details > Next > Register patient**. Use **Back** to review details without losing the address. The address form collects street and barangay, with an optional house/unit/lot number. Municipality is saved automatically as M'lang. Middle name, suffix, contact number, and email are optional.

Reason for visit is entered during registration and saved in an open visit, separately from patient identity. Doctors see it under **Consultations > Waiting for consultation** and select **Review** to document the encounter. Saving the consultation links it to the original visit and removes it from the waiting queue. Laboratory tests are still ordered by the doctor after the consultation.

Laboratory requests now lists all active patients with search and pagination. Select **Request tests**, choose named tests, enter the clinical reason, and sign. Patient and consultation IDs are linked automatically. When consultation is needed, select **Consultation** on the same page; saving continues directly to the laboratory request. New consultations also use patient selection with automatic visit linking.
