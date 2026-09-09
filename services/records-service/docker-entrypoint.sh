#!/bin/sh
set -eu

# The migration runner owns schema changes and is safe to execute again.
node src/db/migrate.js
exec node src/server.js
