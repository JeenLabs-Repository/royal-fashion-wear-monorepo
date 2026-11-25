#!/bin/sh
# Pins a plugin to an exact released version, or undoes a local plugin trial.
# Usage:
#   sh scripts/bump-plugin.sh <repo-name> <version>   pin a released plugin version
#   sh scripts/bump-plugin.sh --check                 show registry pins and installed versions
#   sh scripts/bump-plugin.sh --reset                 restore the committed state after a local trial
# The script never commits. It prints the commit message to use.
set -eu

REGISTRY_FILE=config/plugin-registry.json
BACKEND_FILTER="@dtc/gorgo-medusa-backend"
USERCONFIG=""

usage() {
  cat >&2 <<'EOF'
Usage:
  sh scripts/bump-plugin.sh <repo-name> <version>   pin a released plugin version
  sh scripts/bump-plugin.sh --check                 show registry pins and installed versions
  sh scripts/bump-plugin.sh --reset                 restore the committed state after a local trial
EOF
  exit 2
}

fail() {
  echo "[bump-plugin] $1" >&2
  exit 1
}

cleanup() {
  [ -z "$USERCONFIG" ] || rm -f "$USERCONFIG"
}
trap cleanup EXIT

guard() {
  node scripts/run-guards.mjs --only plugin-refs
}

[ "$#" -ge 1 ] || usage

if [ "$1" = "--check" ]; then
  node -e '
const fs = require("fs");
const registry = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const manifest = JSON.parse(fs.readFileSync("apps/backend/package.json", "utf8"));
const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
for (const [name, repo] of Object.entries(registry.repos)) {
  let installed = "none";
  for (const section of sections) {
    if (manifest[section] && manifest[section][repo.package]) installed = manifest[section][repo.package];
  }
  console.log(name + "  package=" + repo.package + "  pin=" + (repo.pin === null ? "none" : repo.pin) + "  installed=" + installed + "  planned=" + repo.planned);
}
' "$REGISTRY_FILE"
  exit 0
fi

if [ "$1" = "--reset" ]; then
  echo "[bump-plugin] discarding uncommitted changes to apps/backend/package.json and pnpm-lock.yaml:"
  git diff --stat -- apps/backend/package.json pnpm-lock.yaml
  git checkout -- apps/backend/package.json pnpm-lock.yaml
  rm -rf apps/backend/.yalc apps/backend/yalc.lock .yalc yalc.lock
  pnpm install --frozen-lockfile
  guard
  echo "[bump-plugin] restored the committed plugin state."
  exit 0
fi

[ "$#" -eq 2 ] || usage
NAME=$1
VERSION=$2

printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "version must be exact semver such as 1.2.3"

PACKAGE=$(node -p "(require('./$REGISTRY_FILE').repos[process.argv[1]] || {}).package || ''" "$NAME")
[ -n "$PACKAGE" ] || fail "$NAME is not a key of repos in $REGISTRY_FILE"
PLANNED=$(node -p "String((require('./$REGISTRY_FILE').repos[process.argv[1]] || {}).planned)" "$NAME")
[ "$PLANNED" = "false" ] || fail "$NAME is planned and has no release yet"

[ "$(git rev-parse --abbrev-ref HEAD)" = "active-dev" ] || fail "run this on the active-dev branch"
[ -z "$(git status --porcelain)" ] || fail "the working tree is not clean"

REGISTRY=$(node -p "require('./$REGISTRY_FILE').registry")
SCOPE=$(node -p "require('./$REGISTRY_FILE').scope")
TOKEN_ENV=$(node -p "require('./$REGISTRY_FILE').token_env")
printf '%s' "$TOKEN_ENV" | grep -Eq '^[A-Z_][A-Z0-9_]*$' || fail "token_env in the registry file is not a valid variable name"
eval "TOKEN_VALUE=\${$TOKEN_ENV:-}"
[ -n "$TOKEN_VALUE" ] || fail "set $TOKEN_ENV to a token that can read the registry"

# A throwaway npm config reads the token from the environment, so the token is
# never written to a file or put on a command line.
USERCONFIG=$(mktemp)
HOST=$(printf '%s' "$REGISTRY" | sed 's|^https\{0,1\}://||; s|/*$||')
printf '%s:registry=%s\n' "$SCOPE" "$REGISTRY" > "$USERCONFIG"
printf '//%s/:_authToken=${%s}\n' "$HOST" "$TOKEN_ENV" >> "$USERCONFIG"

PUBLISHED=$(NPM_CONFIG_USERCONFIG="$USERCONFIG" npm view "$PACKAGE@$VERSION" version --registry "$REGISTRY" 2>/dev/null || true)
[ "$PUBLISHED" = "$VERSION" ] || fail "$PACKAGE@$VERSION is not published in $REGISTRY"

pnpm --filter "$BACKEND_FILTER" add "$PACKAGE@$VERSION" --save-exact

node -e '
const fs = require("fs");
const file = process.argv[1];
const registry = JSON.parse(fs.readFileSync(file, "utf8"));
registry.repos[process.argv[2]].pin = process.argv[3];
fs.writeFileSync(file, JSON.stringify(registry, null, 2) + "\n");
' "$REGISTRY_FILE" "$NAME" "$VERSION"

guard

echo "[bump-plugin] pinned $PACKAGE to $VERSION. The manifest, the lockfile and $REGISTRY_FILE changed."
echo "Run the tests and builds, then commit all three with:"
echo "  git commit -S -m \"build: bump $NAME to $VERSION\""
