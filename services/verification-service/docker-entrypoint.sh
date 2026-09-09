#!/bin/sh
set -eu

# Migrations are idempotent and run only when the MySQL adapter is selected.
node src/db/migrate.js
exec node src/server.js
