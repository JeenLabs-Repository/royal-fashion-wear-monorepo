#!/bin/sh
# Rehearses a release in a scratch clone. The real repository gets no tag and no commit.
# Usage: sh scripts/rehearse-release.sh [--version x.y.z] [--with-build]
# Run it from the plugin repository root on the active-dev branch. Uncommitted
# changes are not part of the rehearsal because it works on a clone.
set -u

VERSION=0.1.0
WITH_BUILD=0

usage() {
  echo "Usage: sh scripts/rehearse-release.sh [--version x.y.z] [--with-build]" >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || usage
      VERSION=$2
      shift 2
      ;;
    --with-build)
      WITH_BUILD=1
      shift
      ;;
    *)
      usage
      ;;
  esac
done

printf '%s' "$VERSION" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || usage
[ -f package.json ] && [ -d .git ] || { echo "Run this from the plugin repository root." >&2; exit 2; }

FAILURES=0
step() {
  if [ "$2" -eq 0 ]; then
    echo "[PASS] $1"
  else
    echo "[FAIL] $1"
    FAILURES=$((FAILURES + 1))
  fi
}

REAL=$(pwd)
TAGS_BEFORE=$(git tag --list | wc -l | tr -d ' ')
COUNT_BEFORE=$(git rev-list --count HEAD)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/release-rehearsal.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
CLONE="$WORK/clone"

git clone -q "$REAL" "$CLONE"
step "clone the repository into a scratch directory" $?
[ -d "$CLONE/.git" ] || { echo "[FAIL] no clone to work on"; exit 1; }

for key in user.name user.email user.signingkey gpg.format commit.gpgsign tag.gpgsign gpg.ssh.allowedSignersFile; do
  value=$(git config "$key" || true)
  [ -z "$value" ] || git -C "$CLONE" config "$key" "$value"
done

# A scratch bare repository stands in for the remote so the on-main check runs.
git init -q --bare "$WORK/origin.git"
git -C "$CLONE" remote set-url origin "$WORK/origin.git"
git -C "$CLONE" switch -q active-dev
step "switch the clone to active-dev" $?

node -e "
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('$CLONE/package.json', 'utf8'));
manifest.version = process.argv[1];
fs.writeFileSync('$CLONE/package.json', JSON.stringify(manifest, null, 2) + '\n');
" "$VERSION"
git -C "$CLONE" add package.json
git -C "$CLONE" commit -q -S --allow-empty -m "build: set version to $VERSION"
step "commit the version" $?

(cd "$CLONE" && sh scripts/release-prepare.sh "v$VERSION" >/dev/null 2>&1)
step "release-prepare runs on active-dev" $?

git -C "$CLONE" branch -f main HEAD
git -C "$CLONE" switch -q main
(cd "$CLONE" && RELEASE_DRY_RUN=1 sh scripts/release-tag.sh "v$VERSION" >/dev/null 2>&1)
step "release-tag creates the signed tag in dry-run mode" $?

git -C "$CLONE" push -q origin main
git -C "$CLONE" fetch -q origin
(cd "$CLONE" && sh scripts/verify-release-tag.sh "v$VERSION" 2>&1 | grep -q 'release tag verified')
step "the verifier accepts the signed tag" $?

MAJOR=${VERSION%%.*}
REST=${VERSION#*.}
MINOR=${REST%%.*}
PATCH=${REST#*.}
BAD="v$MAJOR.$MINOR.$((PATCH + 1))"
git -C "$CLONE" tag "$BAD"
(cd "$CLONE" && sh scripts/verify-release-tag.sh "$BAD" >/dev/null 2>&1)
STATUS=$?
[ "$STATUS" -eq 1 ]
step "the verifier rejects an unsigned lightweight tag" $?

if [ "$WITH_BUILD" -eq 1 ]; then
  (cd "$CLONE" && pnpm install --frozen-lockfile >/dev/null 2>&1)
  step "install dependencies in the clone" $?
  (cd "$CLONE" && pnpm run build >/dev/null 2>&1)
  step "build the plugin" $?
  TARBALL=$(cd "$CLONE" && npm pack --silent --ignore-scripts 2>/dev/null | tail -n 1)
  [ -n "$TARBALL" ] && [ -f "$CLONE/$TARBALL" ]
  step "pack the plugin" $?
  PACKAGE_NAME=$(cd "$CLONE" && node -p "require('./package.json').name")
  mkdir -p "$WORK/consumer"
  (cd "$WORK/consumer" && npm init -y >/dev/null 2>&1 && npm install "$CLONE/$TARBALL" --legacy-peer-deps --no-audit --no-fund >/dev/null 2>&1)
  step "install the tarball in an empty consumer" $?
  (cd "$WORK/consumer" && node -e "require.resolve(process.argv[1] + '/public')" "$PACKAGE_NAME" >/dev/null 2>&1)
  step "resolve the public entry" $?
  for dir in "$CLONE"/.medusa/server/src/providers/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    (cd "$WORK/consumer" && node -e "require.resolve(process.argv[1] + '/providers/' + process.argv[2])" "$PACKAGE_NAME" "$name" >/dev/null 2>&1)
    step "resolve the provider entry $name" $?
  done
fi

[ "$(git tag --list | wc -l | tr -d ' ')" = "$TAGS_BEFORE" ]
step "the real repository has the same tags" $?
[ "$(git rev-list --count HEAD)" = "$COUNT_BEFORE" ]
step "the real repository has the same commit count" $?

[ "$FAILURES" -eq 0 ] || exit 1
echo "release rehearsal passed for v$VERSION"
