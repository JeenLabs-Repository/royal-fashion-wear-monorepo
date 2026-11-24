#!/bin/sh
# Self-test for the staged scan. Works in a throwaway repository and never
# touches the real repository history.
set -u

root=$(pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failures=0

mkdir -p "$tmp/scripts"
cp "$root/.gitleaks.toml" "$tmp/.gitleaks.toml"
cp "$root/scripts/gitleaks-staged.sh" "$tmp/scripts/gitleaks-staged.sh"

cd "$tmp" || exit 1
git init -q
git config user.email "selftest@example.test"
git config user.name "Self Test"

# expect <name> <zero|nonzero> <command...>
expect() {
  name=$1
  want=$2
  shift 2
  "$@" >/dev/null 2>&1
  status=$?
  if { [ "$want" = zero ] && [ "$status" -eq 0 ]; } || { [ "$want" = nonzero ] && [ "$status" -ne 0 ]; }; then
    echo "[PASS] $name"
  else
    echo "[FAIL] $name (exit $status)"
    failures=$((failures + 1))
  fi
}

# Case 1: a secret-shaped token is blocked. The token is built at run time so
# the full string never appears in this repository.
printf 'token=%s\n' "$(printf 'ghp_%s' aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6)" > leak.txt
git add leak.txt
expect "staged secret is blocked" nonzero sh scripts/gitleaks-staged.sh
git reset -q
rm -f leak.txt

# Case 2: a harmless file passes.
printf 'hello\n' > harmless.txt
git add harmless.txt
expect "harmless file passes" zero sh scripts/gitleaks-staged.sh
git reset -q

# Case 3: the credentials file is blocked even when forced in.
printf 'demo\n' > TEST-CREDENTIALS.local.md
git add -f TEST-CREDENTIALS.local.md
expect "forced credentials file is blocked" nonzero sh scripts/gitleaks-staged.sh
git reset -q

# Case 4: a missing scanner stops the commit (fails closed).
git add harmless.txt
expect "missing scanner fails closed" nonzero env GITLEAKS_BIN=gitleaks-not-installed sh scripts/gitleaks-staged.sh

cd "$root" || exit 1
[ "$failures" -eq 0 ]
