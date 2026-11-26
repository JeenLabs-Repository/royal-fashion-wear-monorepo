#!/bin/sh
# Writes a user-level npmrc auth line that pnpm 12 will expand from NODE_AUTH_TOKEN.
# Project .npmrc auth lines are ignored by pnpm 12 for security; installs need this.
set -eu
TOKEN_ENV="${1:-NODE_AUTH_TOKEN}"
eval "TOKEN_VALUE=\${$TOKEN_ENV:-}"
[ -n "$TOKEN_VALUE" ] || {
  echo "set $TOKEN_ENV before writing the registry userconfig" >&2
  exit 1
}
HOST="${2:-npm.pkg.github.com}"
NPMRC="${HOME}/.npmrc"
touch "$NPMRC"
chmod 600 "$NPMRC"
# Replace an existing auth line for this host, or append.
if grep -q "^//${HOST}/:_authToken=" "$NPMRC" 2>/dev/null; then
  tmp=$(mktemp)
  grep -v "^//${HOST}/:_authToken=" "$NPMRC" > "$tmp"
  mv "$tmp" "$NPMRC"
  chmod 600 "$NPMRC"
fi
printf '//%s/:_authToken=${%s}\n' "$HOST" "$TOKEN_ENV" >> "$NPMRC"
