# Authentication Service

Identity, access-token, rotating refresh-session, password, user, and role service for the local laboratory record platform. Nginx exposes these service-local routes below `/api/auth` and strips that prefix before proxying.

## Run locally

1. Copy `.env.example` to `.env` and replace every secret placeholder.
2. Install and initialize the service:

   ```text
   npm install
   npm run migrate
   npm run seed
   npm start
   ```

Set `DEV_SEED_PASSWORD` in `.env` before the seed step. The seed is idempotent, refuses to run without that variable, and creates one forced-password-change development account for each supported role. It is blocked in production unless `ALLOW_PRODUCTION_SEED=true` is deliberately supplied.

`DB_DRIVER=file` is the native-development default. It persists authentication state through atomic replacement of `DATA_ROOT/auth/auth.json` and is explicitly reported as simulated by `/ready`. Set `DB_DRIVER=mysql` and the `MYSQL_*` values to use the service-owned MySQL database; run the migration before starting the server. The Docker image does this automatically and starts the server only after a successful migration.

Use `GET /health` for liveness, `GET /ready` for database readiness, `/docs` for Swagger UI, and `/openapi.json` for the OpenAPI 3.1 document.

## Token behavior

- Access tokens are short-lived HS256 JWTs containing `sub`, `email`, `roles`, `permissions`, `patientId`, and `mustChangePassword`.
- Refresh tokens are opaque random values. Only SHA-256 hashes are stored; successful refresh rotates the token.
- Reuse of an already rotated token revokes the complete token family.
- The default transport is an `HttpOnly`, `SameSite=Strict` cookie. `/refresh` and `/logout` also accept `refreshToken` in a JSON body for non-browser clients.
- Password changes and resets revoke every refresh session for that user.

## Forced password changes

An access token is still issued so a new account can call `/me`, `/password/change`, and `/logout`. All other protected endpoints reject the account with `PASSWORD_CHANGE_REQUIRED`; refresh is also rejected until the password is changed.

## Tests

`npm test` uses the deterministic in-memory adapter for security behavior and a temporary atomic JSON adapter for persistence/readiness coverage. It does not need MySQL.
