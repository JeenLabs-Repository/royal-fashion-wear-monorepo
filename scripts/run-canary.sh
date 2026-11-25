#!/bin/sh
# Builds, seeds, starts the backend and the storefront and runs the anonymity
# canary crawl against them. Run from anywhere: it moves to the repository root.
#   sh scripts/run-canary.sh [--skip-build]
# Needs: pnpm, curl, openssl, psql, a reachable Postgres server (and Redis if REDIS_URL is set).
# Environment (all optional):
#   CANARY_ADMIN_DATABASE_URL  server URL used to create the throwaway database
#   CANARY_DB_NAME             throwaway database name (default canary_run)
#   CANARY_BACKEND_URL         default http://localhost:9000
#   CANARY_STOREFRONT_URL      default http://localhost:8000
#   CANARY_NODE_ENV            default development (use production once the boot checks pass with test values)
# Secrets are generated per run, never printed and never written to a file.
set -eu

cd "$(dirname "$0")/.."
ROOT=$(pwd)

SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

BACKEND_URL=${CANARY_BACKEND_URL:-http://localhost:9000}
STOREFRONT_URL=${CANARY_STOREFRONT_URL:-http://localhost:8000}
ADMIN_DB_URL=${CANARY_ADMIN_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}
DB_NAME=${CANARY_DB_NAME:-canary_run}
NODE_ENV_VALUE=${CANARY_NODE_ENV:-development}

BACKEND_PID=""
STOREFRONT_PID=""

kill_tree() {
  pid=$1
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  [ -n "$STOREFRONT_PID" ] && kill_tree "$STOREFRONT_PID"
  [ -n "$BACKEND_PID" ] && kill_tree "$BACKEND_PID"
  return 0
}
trap cleanup EXIT INT TERM

step() {
  echo "==> $1"
}

wait_for() {
  url=$1
  name=$2
  waited=0
  until curl -fsS -o /dev/null "$url"; do
    waited=$((waited + 2))
    if [ "$waited" -ge 120 ]; then
      echo "$name did not answer at $url within 120 seconds." >&2
      exit 1
    fi
    sleep 2
  done
}

rand() {
  openssl rand -hex 32
}

command -v psql >/dev/null 2>&1 || { echo "psql is required to create the throwaway database." >&2; exit 1; }

step "Prepare the throwaway database $DB_NAME"
psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" -c "CREATE DATABASE \"$DB_NAME\""

DB_BASE=${ADMIN_DB_URL%/*}
export DATABASE_URL="$DB_BASE/$DB_NAME"
export NODE_ENV="$NODE_ENV_VALUE"
export JWT_SECRET=$(rand)
export COOKIE_SECRET=$(rand)
export INTEGRATION_ENCRYPTION_KEY=$(rand)
export AUTH_MFA_ENCRYPTION_KEY=$(rand)
export REVALIDATE_SECRET=$(rand)
export STORE_CORS="$STOREFRONT_URL"
export ADMIN_CORS="$BACKEND_URL"
export AUTH_CORS="$BACKEND_URL,http://localhost:5173"
export STOREFRONT_URL
export VENDOR_PORTAL_URL="$BACKEND_URL/vendor-portal"
export TRUST_PROXY_HOPS=0
export BREAK_GLASS_ALERT_EMAILS="canary-alerts@example.test"
export MEDUSA_DISABLE_TELEMETRY=true
export NEXT_TELEMETRY_DISABLED=1

if [ "$SKIP_BUILD" -eq 0 ]; then
  step "Build the backend"
  pnpm -C apps/backend run build
fi

step "Migrate the database"
pnpm -C apps/backend exec medusa db:migrate

step "Seed the starter data and the canary vendors"
products=$(psql "$DATABASE_URL" -tAc "select count(*) from product" 2>/dev/null || echo 0)
if [ "${products:-0}" -eq 0 ]; then
  pnpm -C apps/backend run seed
else
  echo "The database already holds products: skipping the starter seed."
fi
pnpm -C apps/backend exec medusa exec ./src/scripts/seed-canary.ts

if curl -fsS -o /dev/null "$BACKEND_URL/health" 2>/dev/null; then
  echo "Something already answers at $BACKEND_URL/health. Stop it so the canary run owns the port." >&2
  exit 1
fi

step "Start the backend ($NODE_ENV_VALUE mode)"
# Prefer REDIS_URL from the environment or the local compose Redis.
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
pnpm -C apps/backend start >"$ROOT/.canary-backend.log" 2>&1 &
BACKEND_PID=$!
wait_for "$BACKEND_URL/health" "The backend"

step "Build and start the storefront"
PUBLISHABLE_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('e2e/.auth/canary-seed.json','utf8')).publishable_key)")
export NEXT_PUBLIC_MEDUSA_BACKEND_URL="$BACKEND_URL"
export NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
export NEXT_PUBLIC_BASE_URL="$STOREFRONT_URL"
export NEXT_PUBLIC_SITE_NAME="Canary Store"
export NEXT_PUBLIC_DEFAULT_REGION="in"
# next build refuses a non-production NODE_ENV; keep the backend's value aside.
STOREFRONT_NODE_ENV=production
NODE_ENV="$STOREFRONT_NODE_ENV" pnpm -C apps/storefront run build
NODE_ENV="$STOREFRONT_NODE_ENV" pnpm -C apps/storefront start >"$ROOT/.canary-storefront.log" 2>&1 &
STOREFRONT_PID=$!
wait_for "$STOREFRONT_URL" "The storefront"
# Restore the backend NODE_ENV for the crawl process and any later steps.
export NODE_ENV="$NODE_ENV_VALUE"

step "Run the canary crawl"
set +e
CANARY_BACKEND_URL="$BACKEND_URL" CANARY_STOREFRONT_URL="$STOREFRONT_URL" pnpm -C apps/backend run test:canary
STATUS=$?
set -e

if [ "$STATUS" -ne 0 ]; then
  echo "The crawl failed. Server logs: .canary-backend.log and .canary-storefront.log (not committed)." >&2
fi
exit "$STATUS"
