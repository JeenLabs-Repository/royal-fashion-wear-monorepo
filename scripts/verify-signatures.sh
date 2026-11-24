#!/bin/sh
# Verifies commit signatures for the commits selected by git rev-list arguments.
# Usage: sh scripts/verify-signatures.sh <rev-list arguments>
#   example: sh scripts/verify-signatures.sh main..HEAD
#   example: sh scripts/verify-signatures.sh HEAD --not origin/main
# Strict mode (STRICT=1, used before a push) needs a good signature on every
# commit. One exception keeps the release routine working: a merge commit that
# GitHub made in its web interface (committer address noreply@github.com) is
# signed with GitHub's own key, which the allowed signers file cannot list, so
# strict mode only warns about it. An unsigned or bad signature still fails.
# Default mode (CI) needs a good signature on every non-merge commit and only
# warns about merge commits that cannot be checked, for the same reason.
set -u

if [ "$#" -eq 0 ]; then
  echo "usage: sh scripts/verify-signatures.sh <rev-list arguments>" >&2
  exit 2
fi

log=$(git -c gpg.ssh.allowedSignersFile=.github/allowed_signers log --format='%H %G? %P' "$@") || exit 1

failures=0

# An empty range gives an empty log and passes. The loop reads a here-document
# so it runs in this shell and can set the failure flag.
while read -r sha status parents; do
  [ -z "$sha" ] && continue
  subject=$(git log -1 --format=%s "$sha")
  count=$(echo "$parents" | wc -w)

  if [ "${STRICT:-0}" = "1" ]; then
    if [ "$status" != "G" ]; then
      committer=$(git log -1 --format=%ce "$sha")
      if [ "$count" -gt 1 ] && [ "$committer" = "noreply@github.com" ] && [ "$status" != "N" ] && [ "$status" != "B" ]; then
        echo "WARN $sha status $status (merge made on GitHub, not checked against the allowed signers): $subject"
      else
        echo "FAIL $sha status $status: $subject"
        failures=1
      fi
    fi
  elif [ "$count" -gt 1 ]; then
    case "$status" in
      N | B | R)
        echo "FAIL $sha status $status (merge): $subject"
        failures=1
        ;;
      G) ;;
      *) echo "WARN $sha status $status (merge, not checked against the allowed signers): $subject" ;;
    esac
  elif [ "$status" != "G" ]; then
    echo "FAIL $sha status $status: $subject"
    failures=1
  fi
done <<EOF
$log
EOF

exit "$failures"
