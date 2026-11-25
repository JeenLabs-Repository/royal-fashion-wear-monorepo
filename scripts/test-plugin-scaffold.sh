#!/bin/sh
# Scaffolds a plugin repository into a temporary directory and checks the result.
# Usage: sh scripts/test-plugin-scaffold.sh
# The scaffolder makes signed commits, so load the signing key into ssh-agent first.
# It refuses a dirty working tree, so commit your work before running this.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

FAILURES=0
pass() {
  echo "[PASS] $1"
}
bad() {
  echo "[FAIL] $1"
  FAILURES=$((FAILURES + 1))
}
expect() {
  label=$1
  shift
  if "$@" >/dev/null 2>&1; then
    pass "$label"
  else
    bad "$label"
  fi
}

NAME=medusa-store-settings
WORK=$(mktemp -d "${TMPDIR:-/tmp}/plugin-scaffold.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
REPO="$WORK/$NAME"

if sh scripts/new-plugin-repo.sh "$NAME" "$REPO"; then
  pass "the scaffolder exits 0"
else
  bad "the scaffolder exits 0"
  echo "[FAIL] nothing to check"
  exit 1
fi

UNSIGNED=$(git -C "$REPO" log --format=%G? | grep -vc '^G$' || true)
[ "$UNSIGNED" = "0" ] && pass "every commit has a good signature" || bad "every commit has a good signature ($UNSIGNED not good)"

BRANCHES=$(git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads | sort | tr '\n' ' ')
[ "$BRANCHES" = "active-dev dev main " ] && pass "branches are active-dev, dev and main" || bad "branches are active-dev, dev and main (found: $BRANCHES)"

[ "$(git -C "$REPO" branch --show-current)" = "active-dev" ] && pass "active-dev is the current branch" || bad "active-dev is the current branch"

[ -z "$(git -C "$REPO" remote)" ] && pass "there is no remote" || bad "there is no remote"

SECTIONS=$(awk '
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  /^\[/ { cur = $0; next }
  { seen[cur] = 1 }
  END { n = 0; for (k in seen) n++; print n }
' tools/plugin-repo-template/manifest.txt)
COMMITS=$(git -C "$REPO" rev-list --count HEAD)
[ "$COMMITS" = "$SECTIONS" ] && pass "one commit per non-empty manifest section ($COMMITS)" || bad "one commit per non-empty manifest section (commits $COMMITS, sections $SECTIONS)"

[ -z "$(git -C "$REPO" status --porcelain)" ] && pass "the working tree is clean" || bad "the working tree is clean"

for file in package.json .github/workflows/ci.yml .github/workflows/publish.yml scripts/verify-release-tag.sh .husky/commit-msg .gitleaks.toml; do
  expect "$file is tracked" git -C "$REPO" ls-files --error-unmatch "$file"
done

if grep -rn '@@' "$REPO" --exclude-dir=.git >/dev/null 2>&1; then
  bad "no unreplaced template tokens"
else
  pass "no unreplaced template tokens"
fi

EXPECTED_PACKAGE=$(node -p "require('./config/plugin-registry.json').repos['$NAME'].package")
ACTUAL_PACKAGE=$(cd "$REPO" && node -p "require('./package.json').name")
[ "$ACTUAL_PACKAGE" = "$EXPECTED_PACKAGE" ] && pass "package name is $EXPECTED_PACKAGE" || bad "package name is $EXPECTED_PACKAGE (found $ACTUAL_PACKAGE)"

expect "workflow pin guard passes in the new repository" sh -c "cd '$REPO' && node scripts/check-workflow-pins.mjs"
expect "plan-reference guard passes in the new repository" sh -c "cd '$REPO' && node scripts/check-no-plan-refs.mjs"
expect "branch-name guard passes in the new repository" sh -c "cd '$REPO' && node scripts/check-branch-name.mjs active-dev"

# The tag verifier must reject bad tags and accept a good one.
# Force an unsigned lightweight tag even when tag.gpgsign is enabled.
git -C "$REPO" -c tag.gpgsign=false tag v0.0.1
OUT=$(cd "$REPO" && sh scripts/verify-release-tag.sh v0.0.1 2>&1)
STATUS=$?
if [ "$STATUS" -eq 1 ] && printf '%s' "$OUT" | grep -q 'not an annotated tag'; then
  pass "the verifier rejects an unsigned lightweight tag"
else
  bad "the verifier rejects an unsigned lightweight tag (status $STATUS)"
fi

git -C "$REPO" tag -s -a v9.9.9 -m "Release v9.9.9"
OUT=$(cd "$REPO" && sh scripts/verify-release-tag.sh v9.9.9 2>&1)
STATUS=$?
if [ "$STATUS" -eq 1 ] && printf '%s' "$OUT" | grep -q 'does not match'; then
  pass "the verifier rejects a signed tag whose version differs from package.json"
else
  bad "the verifier rejects a signed tag whose version differs from package.json (status $STATUS)"
fi

printf '# Changelog\n\n## v0.0.0 (scratch)\n' > "$REPO/CHANGELOG.md"
git -C "$REPO" tag -s -a v0.0.0 -m "Release v0.0.0"
OUT=$(cd "$REPO" && sh scripts/verify-release-tag.sh v0.0.0 2>&1)
STATUS=$?
if [ "$STATUS" -eq 0 ] && printf '%s' "$OUT" | grep -q 'release tag verified'; then
  pass "the verifier accepts a signed annotated tag that matches package.json and the changelog"
else
  bad "the verifier accepts a signed annotated tag that matches package.json and the changelog (status $STATUS)"
  printf '%s\n' "$OUT"
fi

[ "$FAILURES" -eq 0 ] || exit 1
echo "scaffold test passed"
