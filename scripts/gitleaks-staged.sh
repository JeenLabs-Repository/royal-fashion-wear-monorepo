#!/bin/sh
# Pre-commit scan. Fails closed: a missing scanner stops the commit.
# Refuses files that must never be committed, even when added with `git add -f`.
# GITLEAKS_BIN exists so the self-test can simulate a missing scanner.
set -u

GITLEAKS_BIN="${GITLEAKS_BIN:-gitleaks}"

if ! command -v "$GITLEAKS_BIN" >/dev/null 2>&1; then
  echo "gitleaks is required. Install it from https://github.com/gitleaks/gitleaks/releases and re-run the commit." >&2
  exit 1
fi

forbidden=0
paths=$(git diff --cached --name-only --diff-filter=ACMR)

for path in $paths; do
  case "$path" in
    *.template) continue ;;
    TEST-CREDENTIALS.local.md | */TEST-CREDENTIALS.local.md)
      echo "Refusing to commit $path (test credentials stay local)." >&2
      forbidden=1
      continue
      ;;
    .planning/*)
      echo "Refusing to commit $path (planning files stay outside the repository)." >&2
      forbidden=1
      continue
      ;;
  esac
  if printf '%s\n' "$path" | grep -Eq '(^|/)\.env$|(^|/)\.env\.[^/]*$'; then
    echo "Refusing to commit $path (environment files stay local; commit a .template file instead)." >&2
    forbidden=1
  fi
done

if [ "$forbidden" -ne 0 ]; then
  exit 1
fi

if "$GITLEAKS_BIN" git --help 2>&1 | grep -q -- '--pre-commit'; then
  "$GITLEAKS_BIN" git --pre-commit --staged --redact --no-banner --config .gitleaks.toml
else
  "$GITLEAKS_BIN" protect --staged --redact --config .gitleaks.toml
fi
exit $?
