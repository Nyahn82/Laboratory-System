# Offline Synchronization

## Goals

Supported frontend drafts can survive a brief connection loss without creating duplicate patients, specimens, results, storage objects, releases, or ledger registrations. Offline mode does not relax clinical authorization or workflow order.

## Browser queue

IndexedDB stores supported drafts and pending commands with:

- UUID event and idempotency key
- Route/operation and payload
- Entity ID and expected revision when known
- Created time and device/source
- `PENDING`, `SYNCING`, `APPLIED`, `DUPLICATE`, `CONFLICT`, `RETRY_WAIT`, or `FAILED_REVIEW`
- Retry count, last error category, and next retry time

The UI shows online, offline, syncing, synchronized, and failed states. Private drafts are cleared on logout. A production implementation should add session-bound WebCrypto protection for every IndexedDB payload.

Offline supervisor approval, release, user/role changes, backup/restore, and Fabric administration are intentionally unsupported because they require current server state and stronger confirmation.

## Backend outbox

Records writes a domain change, audit event, status history, and outbox event in one database transaction. A worker claims events, calls the owning service with the same idempotency key, stores the receipt, and advances the publication state only after a verified response.

Retry uses bounded exponential delay with jitter. Repeated permanent errors become `FAILED_REVIEW`; they are never dropped.

## Idempotency

The service persists request key, actor, operation, normalized request hash, result status, resource ID, and response reference. Repeating the same key and body returns the original result. Reusing a key for a different body returns `409 Conflict`.

Storage uniqueness includes opaque record ID/version. Verification uniqueness includes opaque record ID/version/event. Database constraints are the final duplicate guard.

## Conflict detection

Updates carry an expected revision or `If-Match` value. If server state advanced while offline, the event returns `CONFLICT` with safe metadata and requires a human decision. Clinical history is never resolved by last-write-wins.

## Recovery scenarios

- Disconnect before sending: queued locally, applied once after reconnect.
- Disconnect after server commit but before response: retry returns the same idempotent result.
- Storage succeeds but receipt delivery fails: retry returns the same encrypted object/version.
- Ledger commits but response is lost: verification reconciles by opaque key/version and returns the existing transaction.
- Invalid transition after reconnect: event becomes conflict/failed review, with no skipped state.

