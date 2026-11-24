#!/bin/sh
# Prepares a release on active-dev: writes the changelog section and commits it.
# Usage: sh scripts/release-prepare.sh vX.Y.Z
# It never pushes and never tags.
set -eu

version="${1:-}"
pattern='^v(0\.[0-9]+\.[0-9]+|[1-9][0-9]*\.[0-9]+\.[0-9]+)$'

fail() {
  echo "$1" >&2
  exit 1
}

printf '%s\n' "$version" | grep -Eq "$pattern" || fail "usage: sh scripts/release-prepare.sh vX.Y.Z (for example v0.1.0)"
[ "$(git branch --show-current)" = "active-dev" ] || fail "Run this on active-dev."
[ -z "$(git status --porcelain)" ] || fail "The working tree must be clean."
if git rev-parse -q --verify "refs/tags/$version" >/dev/null; then
  fail "Tag $version already exists."
fi
[ "$(git config --get commit.gpgsign)" = "true" ] || fail "commit.gpgsign must be true."

node scripts/changelog.mjs --version "$version" >/dev/null

section=$(awk -v heading="## $version " 'index($0, heading) == 1 { found = 1; print; next } found && /^## / { exit } found { print }' CHANGELOG.md)
printf '%s\n' "$section"

if ! printf '%s\n' "$section" | node scripts/check-no-plan-refs.mjs --stdin; then
  if git ls-files --error-unmatch CHANGELOG.md >/dev/null 2>&1; then
    git checkout -- CHANGELOG.md
  else
    rm -f CHANGELOG.md
  fi
  fail "The changelog section mentions planning numbers. Reword the commits and run again."
fi

git add CHANGELOG.md
git commit -m "docs: update changelog for $version"
