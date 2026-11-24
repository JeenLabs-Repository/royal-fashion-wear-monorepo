#!/bin/sh
# Proves that an admin session survives a backend restart because sessions live
# in Redis. Run it against the production-like stack from scripts/local-prod.sh.
#
# Usage: ADMIN_EMAIL=<email> ADMIN_PASSWORD=<password> sh scripts/verify-session-survives-restart.sh
#
# Variables:
#   BACKEND_URL     backend address, default http://127.0.0.1:19000
#   ADMIN_EMAIL     admin login printed by local-prod.sh (required)
#   ADMIN_PASSWORD  admin password printed by local-prod.sh (required)
#   COMPOSE         compose command used for Redis and the restart
set -eu

cd "$(dirname "$0")/.."

BACKEND_URL=${BACKEND_URL:-http://127.0.0.1:19000}
COMPOSE=${COMPOSE:-docker compose -p local-prod --env-file deploy/.env.local-prod -f deploy/docker-compose.yml -f deploy/docker-compose.local-prod.yml}
: "${ADMIN_EMAIL:?set ADMIN_EMAIL}"
: "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}"

fail() {
  echo "FAILED at step: $1" >&2
  exit 1
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The backend runs with secure cookies. The proxy in front of it normally tells
# it the request arrived over HTTPS, so the test sends the same header and
# passes the cookie by hand instead of through a cookie jar.
FORWARD="X-Forwarded-Proto: https"

echo "Step 1: log in"
login_status=$(curl -sS -o "$work/login.json" -w '%{http_code}' \
  -X POST "$BACKEND_URL/auth/user/emailpass" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}") || fail "log in (request error)"
[ "$login_status" = "200" ] || fail "log in (status $login_status)"
token=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$work/login.json','utf8')).token || '')")
[ -n "$token" ] || fail "log in (no token in the response)"

echo "Step 2: create a session"
session_status=$(curl -sS -D "$work/session.headers" -o /dev/null -w '%{http_code}' \
  -X POST "$BACKEND_URL/auth/session" \
  -H "Authorization: Bearer $token" \
  -H "$FORWARD") || fail "create a session (request error)"
[ "$session_status" = "200" ] || fail "create a session (status $session_status)"
cookie=$(grep -i '^set-cookie: connect.sid=' "$work/session.headers" | head -n 1 | sed 's/^[^:]*: //; s/;.*//' | tr -d '\r')
[ -n "$cookie" ] || fail "create a session (no session cookie was set; check the proxy header handling)"

whoami() {
  curl -sS -o /dev/null -w '%{http_code}' "$BACKEND_URL/admin/users/me" \
    -H "Cookie: $cookie" -H "$FORWARD"
}

echo "Step 3: call the admin API with the session cookie"
[ "$(whoami)" = "200" ] || fail "call the admin API before the restart"

echo "Step 4: check that Redis holds the session"
sessions=$($COMPOSE exec -T redis redis-cli --scan --pattern 'sess:*' | grep -c 'sess:' || true)
[ "$sessions" -ge 1 ] || fail "find a sess:* key in Redis"

echo "Step 5: restart the backend"
$COMPOSE restart backend >/dev/null
attempts=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$BACKEND_URL/health" || true)" = "200" ]; do
  attempts=$((attempts + 1))
  [ "$attempts" -lt 60 ] || fail "wait for /health after the restart"
  sleep 2
done

echo "Step 6: call the admin API again with the same cookie"
[ "$(whoami)" = "200" ] || fail "call the admin API after the restart"

echo "SESSION_SURVIVED"
