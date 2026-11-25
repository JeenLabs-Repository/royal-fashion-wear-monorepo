#!/bin/sh
# Verifies a release tag before anything is published.
# Usage: sh scripts/verify-release-tag.sh <tag>
# A tag passes only when it is vX.Y.Z, an annotated tag with a good signature
# from .github/allowed_signers, its version equals package.json, CHANGELOG.md has
# its heading, and its commit is on origin/main (checked when origin/main exists).
set -u

TAG=${1:-}
FAILED=0

note() {
  echo "[verify-release-tag] $1" >&2
  FAILED=1
}

if [ -z "$TAG" ]; then
  echo "Usage: sh scripts/verify-release-tag.sh <tag>" >&2
  exit 2
fi

if git remote | grep -qx origin; then
  git fetch --force --tags origin >/dev/null 2>&1 || note "could not fetch tags from origin"
fi

if ! printf '%s' "$TAG" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  note "tag $TAG does not match vX.Y.Z"
  exit 1
fi

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  note "tag $TAG does not exist"
  exit 1
fi

if [ "$(git cat-file -t "refs/tags/$TAG")" != "tag" ]; then
  note "tag $TAG is not an annotated tag"
fi

SIGNATURE_OUTPUT=$(git -c gpg.ssh.allowedSignersFile=.github/allowed_signers tag -v "$TAG" 2>&1 || true)
if ! printf '%s' "$SIGNATURE_OUTPUT" | grep -q 'Good "git" signature'; then
  note "tag $TAG has no good signature from .github/allowed_signers"
fi

PACKAGE_VERSION=$(node -p "require('./package.json').version")
if [ "$PACKAGE_VERSION" != "${TAG#v}" ]; then
  note "package.json version $PACKAGE_VERSION does not match tag $TAG"
fi

if ! awk -v heading="## $TAG " 'index($0, heading) == 1 { found = 1 } END { exit found ? 0 : 1 }' CHANGELOG.md 2>/dev/null; then
  note "CHANGELOG.md has no heading for $TAG"
fi

if git rev-parse -q --verify refs/remotes/origin/main >/dev/null; then
  TAG_COMMIT=$(git rev-list -n 1 "$TAG")
  if ! git merge-base --is-ancestor "$TAG_COMMIT" origin/main; then
    note "the commit of $TAG is not on origin/main"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "release tag verified: $TAG"
