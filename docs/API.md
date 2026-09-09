# API Guide

## Conventions

The Docker entry point is `http://localhost:8080`. Vite uses the same paths through development proxies.

```text
/api/auth/*          -> Authentication Service
/api/records/*       -> Records & Sync Service
/api/storage/*       -> Encrypted Storage Service
/api/verification/*  -> Verification Service
/verify/*             -> Public React verification page
```

Successful and failed JSON responses use one envelope:

```json
{
  "success": true,
  "message": "Readable message",
  "data": {},
  "errors": []
}
```

Protected requests use `Authorization: Bearer <access-token>`. Protected mutations use an `Idempotency-Key` containing 8-128 safe characters. Services return/forward `X-Request-ID`. Date-times are ISO 8601 UTC.

## Common endpoints

Every service exposes:

- `GET /health` - process liveness.
- `GET /ready` - dependency and adapter readiness.
- `GET /openapi.json` - OpenAPI document when generated in code.
- `GET /docs` - Swagger UI.

Swagger through the gateway:

- `http://localhost:8080/api/auth/docs`
- `http://localhost:8080/api/records/docs`
- `http://localhost:8080/api/storage/docs`
- `http://localhost:8080/api/verification/docs`

## Authentication

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/password/change`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/confirm`
- `GET|POST /api/auth/users`
- `PATCH /api/auth/users/:id`
- `GET /api/auth/roles`

Access tokens are short lived. Browser refresh uses an HttpOnly cookie; API clients may submit the opaque refresh token in the body. Successful refresh rotates the token.

## Records and workflow

The main Phase One surface includes:

- Dashboard: `GET /api/records/dashboard`
- Patients: `GET|POST /api/records/patients`, `GET|PATCH /api/records/patients/:id`, `POST /api/records/patients/:id/link`
- Visits/consultations: `GET|POST /api/records/visits`, `GET|POST /api/records/consultations`
- Request patient directory: `GET /api/records/request-patients` (doctor only). Lists all active patients with demographic search and pagination. Returns the current doctor's signed consultation for the latest visit, or an unreviewed visit to consult. Other doctors' clinical notes are excluded.
- Requests: `GET|POST /api/records/orders`, `GET /api/records/orders/:id`. Lists include patient names, panel codes, and individual test names.
- Payment is deferred: `/orders/:id/payment` and `/orders/:id/payment-classification` are unavailable (404). Requested orders can be accessioned directly.
- Specimens: `POST /api/records/orders/:id/accession`, `/collection`, `/receive`, `/rejection`
- Results: `POST /api/records/orders/:id/results`, `/qc`, `/repeat-tests`, `/referrals`, `/submit`
- Supervisor: `POST /api/records/orders/:id/approval`, `/release`
- Doctor: `POST /api/records/orders/:id/doctor-review`
- Patient: `GET /api/records/me/results`, `GET /api/records/me/results/:id`
- Audit: `GET /api/records/audit`
- Sync: `GET /api/records/sync/outbox`, `POST /api/records/sync/outbox/:id/retry`, `POST /api/records/sync/events`

Clients do not patch statuses directly. Command endpoints enforce the actor role, required prior state, domain guard, append-only history, and idempotency record.

## Storage (internal)

Storage mutations require `X-Internal-Service-Token` and are not intended for ordinary browser use:

- `POST /api/storage/packages`
- `GET /api/storage/packages/:recordId/versions/:version`
- `POST /api/storage/packages/:recordId/versions/:version/verify`
- `GET /api/storage/jobs` for authorized operations staff.

Plaintext exists only in process memory during an authorized call. The stored object is an authenticated encrypted envelope.

## Verification

- `POST /api/verification/registrations` - internal proof registration.
- `POST /api/verification/records/:recordId/versions/:version/release` - internal release registration/token issue.
- `GET /api/verification/records/:recordId/history` - authorized staff history.
- `GET /api/verification/public/:token` - anonymous redacted verification.

The public response deliberately omits patient identity, clinical fields, laboratory values, CID, encryption fields, and the submitted token.

## Pagination, search, filters, sorting

Collection endpoints accept `page`, `pageSize`, `search`, `status`, `sort`, and `direction` where applicable. Defaults are bounded. Unknown sort fields are rejected rather than interpolated into SQL.

## HTTP status summary

- `200` read/command success.
- `201` resource created.
- `204` successful empty response only when the standard envelope is not needed.
- `400` validation or invalid transition.
- `401` missing/invalid authentication.
- `403` authenticated but outside role/record boundary.
- `404` resource not found or deliberately concealed by ownership policy.
- `409` idempotency conflict, duplicate identifier, version conflict, or state conflict.
- `422` well-formed request that violates a domain rule.
- `429` rate limit.
- `503` required dependency unavailable; no false success state is recorded.


### Patient addresses

Registration collects patient details, then street and barangay (required), with an optional house/unit/lot number. Municipality is fixed to M'lang and is not an editable form field. The API defaults an omitted municipality to M'lang and rejects another municipality in structured addresses. `POST /api/records/patients` accepts an optional `addressDetails` object with `houseNumber`, `street`, `barangay`, `municipality` (city or municipality), `province`, `region`, `postalCode`, and `country`. Components are saved separately and the service derives `address` for existing displays and reports. Legacy free-text `address` is still accepted. When patching, `addressDetails` replaces the whole structured address; null clears it. An unrelated identity update preserves the address.

Reason for visit is entered during registration and saved in an open visit, separately from patient identity. Doctors see it under **Consultations > Waiting for consultation** and select **Review** to document the encounter. Saving the consultation links it to the original visit and removes it from the waiting queue. Laboratory tests are still ordered by the doctor after the consultation.
