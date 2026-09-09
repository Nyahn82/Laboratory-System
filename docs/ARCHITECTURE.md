# Architecture

## Boundary

RHU LabChain Phase One is a local academic prototype for synthetic or formally de-identified records. One Windows computer simulates service and ledger separation. It is not a production clinical system, a diagnostic engine, or evidence of physical blockchain decentralization.

## Runtime topology

```text
Browser
  |
  v
Nginx :8080  ----> React/Vite web application
  |
  +----> Authentication Service ------> auth_db
  +----> Records & Sync Service ------> records_db
  +----> Encrypted Storage Service ---> storage_db + private Kubo
  `----> Verification Service --------> verification_db + Fabric Gateway
                                                       |
                               peer0.rhu.local -- orderer -- peer0.verifier.local
                                      \________ labrecords ________/
```

Nginx is the only host-bound Docker endpoint. MySQL, Kubo, peers, and the orderer are internal. Services never query another service's schema.

## Four service ownership boundaries

| Service | Owns | Explicitly does not own |
|---|---|---|
| Authentication | Credentials, roles, permissions, access/refresh sessions, password reset, account state, authentication audit | Patients, consultations, laboratory values, encryption keys, ledger assets |
| Records & Sync | Patients, visits, consultations, signed requests, specimens, results/versions, QC, repeats/referrals, approval/release, doctor review, audit, outbox | Password hashes, master keys, IPFS administration, Fabric identity material |
| Encrypted Storage | Canonical serialization, AES-GCM packages, wrapped data keys, object versions, CIDs, retrieval integrity/audit | Clinical access policy, result approval, user authentication, ledger policy |
| Verification | Fabric calls/adapters, opaque proof history, QR token digests, redacted public verification, ledger receipts | Patient identity, addresses, clinical notes, measured values, passwords, keys |

## Adapters and honesty

The same service interfaces have explicit adapter modes:

- `DB_DRIVER=mysql` uses the owning MySQL database. Test/native fallback adapters are never reported as MySQL.
- `OBJECT_STORE_DRIVER=ipfs` uses the private Kubo API. `filesystem` stores encrypted envelopes locally and reports itself as simulated.
- `LEDGER_DRIVER=fabric` uses Fabric Gateway. `file` uses an append-only development ledger and reports itself as simulated.

`/health` proves process liveness. `/ready` reports dependencies and the selected adapter. The frontend repeats simulated-adapter warnings.

## Publication saga

1. A supervisor approves an immutable submitted result version.
2. Records commits approval, status history, audit, and an outbox event atomically.
3. Storage canonicalizes the final snapshot and creates a fresh AES-256-GCM data package.
4. Storage returns an opaque object ID, version, ciphertext hash, and private object reference.
5. Verification registers only the opaque record/version/proof fields.
6. Records stores both receipts and advances to `LEDGER_REGISTERED`.
7. A supervisor releases the registered version.
8. Verification records release, issues an opaque verification token, and returns the public URL.
9. Patients and authorized doctors may retrieve the released version. Doctor review remains a separate append-only event.

Failures remain visible in an outbox/retry state. No failed infrastructure call is silently represented as stored, registered, or released.

## Core status model

```text
REQUESTED
 -> ACCESSIONED
 -> COLLECTED
 -> IN_TESTING
 -> FOR_VERIFICATION
 -> APPROVED
 -> STORAGE_PENDING -> STORED
 -> LEDGER_PENDING -> LEDGER_REGISTERED
 -> RELEASED
```

`QC_FAILED`, `REPEAT_REQUIRED`, `REFERRED`, `REJECTED`, `CANCELLED`, and `CORRECTED` are validated branches. A correction creates a linked new result version. `DOCTOR_REVIEWED` is a derived event and does not replace the released state.

## Role separation

System administrators have no implicit clinical superuser access. Registration staff manage identity and visits, doctors manage consultations/orders/reviews for authorized patients, laboratory staff manage specimens/results/QC, supervisors approve/reject/release, and patients see only their own released records. Public verification is anonymous but strictly redacted.

