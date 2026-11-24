#!/bin/sh
set -eu

cd /app/.medusa/server

# Migrations may also run the scripts in src/migration-scripts. Those scripts
# must create no demo data in production; scripts/local-prod.sh checks that on
# an empty database before any real deploy.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] running database migrations"
  /app/node_modules/.bin/medusa db:migrate
else
  echo "[entrypoint] skipping database migrations (RUN_MIGRATIONS=${RUN_MIGRATIONS})"
fi

exec /app/node_modules/.bin/medusa start
