#!/bin/sh
# Squashes fixup commits on a feature branch without an editor.
# Usage: sh scripts/squash-fixups.sh <base-ref>
# It rewrites only commits that are not on dev yet. It never pushes.
set -eu

base="${1:-}"

fail() {
  echo "$1" >&2
  exit 1
}

[ -n "$base" ] || fail "usage: sh scripts/squash-fixups.sh <base-ref>"

branch=$(git branch --show-current)
case "$branch" in
  main | dev) fail "Never rewrite $branch." ;;
esac

[ -z "$(git status --porcelain)" ] || fail "The working tree must be clean."
git merge-base --is-ancestor "$base" HEAD || fail "$base is not an ancestor of HEAD."

for ref in dev origin/dev; do
  if git rev-parse -q --verify "$ref" >/dev/null; then
    for sha in $(git rev-list "$base..HEAD"); do
      if git merge-base --is-ancestor "$sha" "$ref"; then
        fail "Commit $sha is already in $ref. Promoted commits are never rewritten."
      fi
    done
  fi
done

GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash "$base"

STRICT=1 sh scripts/verify-signatures.sh "$base..HEAD"
echo "Fixups squashed and every commit in $base..HEAD is signed."
