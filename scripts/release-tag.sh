#!/bin/sh
# Creates a signed annotated tag on main after the owner merged the promotion.
# Usage: sh scripts/release-tag.sh vX.Y.Z
# RELEASE_DRY_RUN=1 skips only the origin/main comparison, for rehearsals in a
# temporary clone. The script never pushes.
set -eu

version="${1:-}"
pattern='^v(0\.[0-9]+\.[0-9]+|[1-9][0-9]*\.[0-9]+\.[0-9]+)$'

fail() {
  echo "$1" >&2
  exit 1
}

printf '%s\n' "$version" | grep -Eq "$pattern" || fail "usage: sh scripts/release-tag.sh vX.Y.Z (for example v0.1.0)"
[ "$(git branch --show-current)" = "main" ] || fail "Run this on main after the promotion is merged."
[ -z "$(git status --porcelain)" ] || fail "The working tree must be clean."
if git rev-parse -q --verify "refs/tags/$version" >/dev/null; then
  fail "Tag $version already exists."
fi
grep -F "## $version " CHANGELOG.md | grep -q '^## ' || fail "CHANGELOG.md has no section for $version."

if [ "${RELEASE_DRY_RUN:-0}" != "1" ]; then
  git fetch origin
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "Local main differs from origin/main. Pull the merged promotion first."
fi

body=$(awk -v heading="## $version " 'index($0, heading) == 1 { found = 1; next } found && /^## / { exit } found { print }' CHANGELOG.md)
message=$(printf 'Release %s\n\n%s\n' "$version" "$body")

if ! printf '%s\n' "$message" | node scripts/check-no-plan-refs.mjs --stdin; then
  fail "The tag text mentions planning numbers."
fi

git tag -s -a "$version" -m "$message"

if ! output=$(git -c gpg.ssh.allowedSignersFile=.github/allowed_signers tag -v "$version" 2>&1) \
  || ! printf '%s\n' "$output" | grep -q 'Good "git" signature'; then
  git tag -d "$version" >/dev/null
  fail "The new tag does not carry a good signature. It was deleted."
fi

printf '%s\n' "$output"
echo "Created signed tag $version. Publish it with:"
echo "  OWNER_PROMOTION=1 git push origin $version"
