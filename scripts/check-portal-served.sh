#!/bin/sh
# Proves that the backend serves the built vendor portal under /vendor-portal/,
# with its security headers, and that it does not shadow or leak into the API
# routes.
#   sh scripts/check-portal-served.sh [base-url]
#       checks a backend that is already running and holds a portal build
#       (pnpm backend:dev after a portal build, or the backend image)
#   sh scripts/check-portal-served.sh --start-backend [--skip-build] [base-url]
#       also creates a throwaway database, builds and migrates the backend,
#       starts it, runs the checks and stops it again (needs psql, a Postgres
#       server and a built portal; this is the mode CI uses)
# The base URL defaults to $BACKEND_URL, then http://localhost:9000.
set -eu

START_BACKEND=0
SKIP_BUILD=0
BASE_ARG=""
for arg in "$@"; do
  case "$arg" in
    --start-backend) START_BACKEND=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -*) echo "Unknown argument: $arg" >&2; exit 2 ;;
    *) BASE_ARG="$arg" ;;
  esac
done

BASE="${BASE_ARG:-${BACKEND_URL:-http://localhost:9000}}"
BASE="${BASE%/}"
failures=0
BACKEND_PID=""
tmp="$(mktemp -d)"

kill_tree() {
  pid=$1
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  if [ -n "$BACKEND_PID" ]; then kill_tree "$BACKEND_PID"; fi
  rm -rf "$tmp"
  return 0
}
trap cleanup EXIT INT TERM

pass() { printf '[PASS] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; failures=$((failures + 1)); }

if ! command -v curl >/dev/null 2>&1; then
  echo "NOT VERIFIED: curl is not installed"
  exit 2
fi

if [ "$START_BACKEND" -eq 1 ]; then
  cd "$(dirname "$0")/.."
  ROOT=$(pwd)
  if [ ! -f apps/backend/static/vendor-portal/index.html ]; then
    echo "NOT VERIFIED: the portal is not built (run pnpm -C apps/vendor-portal run build first)"
    exit 2
  fi
  if ! command -v psql >/dev/null 2>&1; then
    echo "NOT VERIFIED: psql is required to create the throwaway database"
    exit 2
  fi

  ADMIN_DB_URL="${CHECK_ADMIN_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
  DB_NAME="${CHECK_DB_NAME:-portal_check}"
  if ! psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" -c "CREATE DATABASE \"$DB_NAME\""; then
    echo "NOT VERIFIED: could not create the throwaway database (set CHECK_ADMIN_DATABASE_URL)"
    exit 2
  fi

  # Test-only values, generated per run and never printed. Keep this list in
  # step with the variables scripts/run-canary.sh exports.
  rand() { openssl rand -hex 32; }
  export DATABASE_URL="${ADMIN_DB_URL%/*}/$DB_NAME"
  export NODE_ENV=development
  export JWT_SECRET="$(rand)"
  export COOKIE_SECRET="$(rand)"
  export INTEGRATION_ENCRYPTION_KEY="$(rand)"
  export AUTH_MFA_ENCRYPTION_KEY="$(rand)"
  export REVALIDATE_SECRET="$(rand)"
  export STORE_CORS="http://localhost:8000"
  export ADMIN_CORS="$BASE"
  export AUTH_CORS="$BASE,http://localhost:5173"
  export STOREFRONT_URL="http://localhost:8000"
  export VENDOR_PORTAL_URL="$BASE/vendor-portal"
  export VENDOR_PORTAL_DIR="$ROOT/apps/backend/static/vendor-portal"
  export TRUST_PROXY_HOPS=0
  export BREAK_GLASS_ALERT_EMAILS="portal-check@example.test"
  export MEDUSA_DISABLE_TELEMETRY=true
  export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

  if [ "$SKIP_BUILD" -eq 0 ]; then
    pnpm -C apps/backend run build
  fi
  pnpm -C apps/backend exec medusa db:migrate
  pnpm -C apps/backend start >"$tmp/backend.log" 2>&1 &
  BACKEND_PID=$!

  waited=0
  until curl -fsS -o /dev/null "$BASE/health" 2>/dev/null; do
    waited=$((waited + 2))
    if [ "$waited" -ge 120 ]; then
      echo "The backend did not answer at $BASE/health within 120 seconds. Last log lines:" >&2
      tail -n 30 "$tmp/backend.log" >&2 || true
      exit 1
    fi
    sleep 2
  done
fi

# fetch <path> prints the status code and leaves the headers in $tmp/headers and
# the body in $tmp/body. --path-as-is keeps dot segments exactly as written.
fetch() {
  curl -sS -o "$tmp/body" -D "$tmp/headers" --path-as-is --max-time 15 \
    -w '%{http_code}' "$BASE$1" 2>/dev/null || true
}

has_header() { grep -i -q "^$1" "$tmp/headers"; }

code="$(fetch /health)"
if [ "$code" != "200" ]; then
  echo "NOT VERIFIED: backend not reachable at $BASE (health answered $code)"
  exit 2
fi

code="$(fetch /vendor-portal/)"
if [ "$code" = "200" ] && grep -q 'id="root"' "$tmp/body"; then
  pass "GET /vendor-portal/ answers 200 with the portal index"
else
  fail "GET /vendor-portal/ answered $code (is the portal built into the backend static directory?)"
fi

if has_header "content-security-policy:.*default-src 'self'" \
  && has_header "content-security-policy:.*frame-ancestors 'none'" \
  && has_header "content-security-policy:.*script-src 'self'"; then
  pass "the content security policy is present with default-src, script-src and frame-ancestors"
else
  fail "the content security policy is missing or incomplete"
fi

if grep -i "^content-security-policy:" "$tmp/headers" | grep -q "unsafe-inline.*script-src\|script-src[^;]*unsafe-"; then
  fail "the policy allows unsafe script sources"
else
  pass "the policy allows no unsafe script source"
fi

has_header "cache-control:.*no-store" && pass "the index is never cached" || fail "the index lacks Cache-Control: no-store"
has_header "referrer-policy: no-referrer" && pass "Referrer-Policy is no-referrer" || fail "Referrer-Policy is missing"
has_header "x-content-type-options: nosniff" && pass "X-Content-Type-Options is nosniff" || fail "X-Content-Type-Options is missing"
has_header "x-robots-tag:.*noindex" && pass "X-Robots-Tag is noindex" || fail "X-Robots-Tag is missing"

code="$(fetch /vendor-portal/agreement)"
if [ "$code" = "200" ] && grep -q 'id="root"' "$tmp/body"; then
  pass "a deep link falls back to the index"
else
  fail "a deep link answered $code"
fi

asset="$(curl -sS --max-time 15 "$BASE/vendor-portal/" | grep -o '/vendor-portal/assets/[^"]*' | head -n 1 || true)"
if [ -z "$asset" ]; then
  fail "the index references no asset under /vendor-portal/assets/"
else
  code="$(fetch "$asset")"
  if [ "$code" = "200" ] && has_header "cache-control:.*immutable" && has_header "x-content-type-options: nosniff"; then
    pass "a hashed asset is served as immutable ($asset)"
  else
    fail "the asset $asset answered $code or lacks the immutable cache header"
  fi
fi

code="$(fetch /vendor-portal/assets/does-not-exist.js)"
[ "$code" = "404" ] && pass "a missing asset answers 404" || fail "a missing asset answered $code"

for p in \
  "/vendor-portal/../admin" \
  "/vendor-portal/%2e%2e/admin" \
  "/vendor-portal/%2E%2E%2Fadmin" \
  "/vendor-portal/..%2fadmin" \
  "/vendor-portal/%252e%252e/admin" \
  "/vendor-portal/..%5cadmin" \
  "/vendor-portal/assets/../../package.json"
do
  code="$(fetch "$p")"
  if [ "$code" = "404" ] && ! grep -q 'id="root"' "$tmp/body"; then
    pass "traversal refused: $p"
  else
    fail "traversal not refused ($code): $p"
  fi
done

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$BASE/vendor-portal/" 2>/dev/null || true)"
[ "$code" != "200" ] && pass "POST to the portal path is not served ($code)" || fail "POST to the portal path answered 200"

# The API routes stay API routes: without credentials they refuse, and they
# never answer with the portal index.
for p in /admin/users /vendor/me; do
  code="$(fetch "$p")"
  if { [ "$code" = "401" ] || [ "$code" = "403" ]; } && ! grep -q 'id="root"' "$tmp/body"; then
    pass "$p still answers as an API route ($code)"
  else
    fail "$p answered $code or returned the portal index"
  fi
done

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "PORTAL_SERVED_CHECKS_COMPLETE"
