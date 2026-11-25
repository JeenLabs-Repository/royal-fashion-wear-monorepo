#!/bin/sh
# Creates a plugin repository from this repository's own tooling files.
# Usage: sh scripts/new-plugin-repo.sh <repo-name> [target-dir]
# The new repository gets signed commits (one per manifest section), the branches
# main, dev and active-dev, and no remote. The script never pushes and never
# installs packages.
set -eu

MANIFEST=tools/plugin-repo-template/manifest.txt
REGISTRY_FILE=config/plugin-registry.json
TEMPLATE_DIR=tools/plugin-repo-template/files
CI_FILE=.github/workflows/ci.yml
SEDFILE=""
LISTFILE=""
TARGET=""
CREATED=0
COMMITS=0

usage() {
  echo "Usage: sh scripts/new-plugin-repo.sh <repo-name> [target-dir]" >&2
  echo "The repo name must be a key of repos in $REGISTRY_FILE." >&2
  exit 2
}

fail() {
  echo "[new-plugin-repo] $1" >&2
  exit 1
}

cleanup() {
  status=$?
  [ -z "$SEDFILE" ] || rm -f "$SEDFILE"
  [ -z "$LISTFILE" ] || rm -f "$LISTFILE"
  if [ "$status" -ne 0 ] && [ "$CREATED" = 1 ] && [ -n "$TARGET" ]; then
    rm -rf "$TARGET"
    echo "[new-plugin-repo] removed the partial repository at $TARGET" >&2
  fi
}
trap cleanup EXIT

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage
NAME=$1

[ -f pnpm-workspace.yaml ] || fail "run this from the app repository root"
[ -f "$REGISTRY_FILE" ] || fail "$REGISTRY_FILE is missing"
[ -f "$MANIFEST" ] || fail "$MANIFEST is missing"
[ -z "$(git status --porcelain)" ] || fail "the working tree is not clean"
[ "$(git config commit.gpgsign || true)" = "true" ] || fail "commit.gpgsign must be true"
[ -n "$(git config user.signingkey || true)" ] || fail "user.signingkey is not set"

PACKAGE=$(node -p "(require('./$REGISTRY_FILE').repos[process.argv[1]] || {}).package || ''" "$NAME")
[ -n "$PACKAGE" ] || fail "$NAME is not a key of repos in $REGISTRY_FILE"
DESCRIPTION=$(node -p "(require('./$REGISTRY_FILE').repos[process.argv[1]] || {}).description || ''" "$NAME")
SCOPE=$(node -p "require('./$REGISTRY_FILE').scope || ''")
REGISTRY=$(node -p "require('./$REGISTRY_FILE').registry || ''")
[ -n "$SCOPE" ] && [ "$SCOPE" != "@" ] || fail "the registry scope is not set"
OWNER=${SCOPE#@}

TARGET=${2:-../$NAME}
[ ! -e "$TARGET" ] || fail "$TARGET already exists"

action_ref() {
  grep -m1 -E "uses: *$1@" "$CI_FILE" | sed 's/^.*uses: *//' | tr -d '\r'
}
workflow_env() {
  grep -m1 -E "^ *$1:" "$CI_FILE" | sed 's/^[^:]*: *//' | tr -d '"\r '
}

USES_CHECKOUT=$(action_ref actions/checkout)
USES_PNPM=$(action_ref pnpm/action-setup)
USES_SETUP_NODE=$(action_ref actions/setup-node)
GITLEAKS_VERSION=$(workflow_env GITLEAKS_VERSION)
GITLEAKS_SHA256=$(workflow_env GITLEAKS_SHA256)
for value in "$USES_CHECKOUT" "$USES_PNPM" "$USES_SETUP_NODE" "$GITLEAKS_VERSION" "$GITLEAKS_SHA256"; do
  [ -n "$value" ] || fail "could not read an action pin or gitleaks value from $CI_FILE"
done

esc() {
  printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'
}

SEDFILE=$(mktemp)
LISTFILE=$(mktemp)
emit() {
  printf 's|@@%s@@|%s|g\n' "$1" "$(esc "$2")" >> "$SEDFILE"
}
emit NAME "$NAME"
emit PACKAGE "$PACKAGE"
emit SCOPE "$SCOPE"
emit OWNER "$OWNER"
emit REGISTRY "$REGISTRY"
emit DESCRIPTION "$DESCRIPTION"
emit USES_CHECKOUT "$USES_CHECKOUT"
emit USES_PNPM "$USES_PNPM"
emit USES_SETUP_NODE "$USES_SETUP_NODE"
emit GITLEAKS_VERSION "$GITLEAKS_VERSION"
emit GITLEAKS_SHA256 "$GITLEAKS_SHA256"

git init -q -b main "$TARGET"
CREATED=1
for key in user.name user.email user.signingkey gpg.format commit.gpgsign tag.gpgsign; do
  value=$(git config "$key" || true)
  [ -z "$value" ] || git -C "$TARGET" config "$key" "$value"
done
git -C "$TARGET" config gpg.ssh.allowedSignersFile .github/allowed_signers

entries_of() {
  awk -v want="[$1]" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    /^\[/ { cur = $0; next }
    cur == want { print }
  ' "$MANIFEST"
}

place_entry() {
  entry=$1
  kind=${entry%%:*}
  rest=${entry#*:}
  case "$rest" in
    *' => '*)
      src=${rest%% => *}
      dest=${rest#* => }
      ;;
    *)
      src=$rest
      dest=$rest
      ;;
  esac
  mkdir -p "$(dirname "$TARGET/$dest")"
  case "$kind" in
    app)
      [ -e "$src" ] || fail "manifest source $src does not exist in this repository"
      if [ -d "$src" ]; then
        mkdir -p "$TARGET/$dest"
        cp -R "$src/." "$TARGET/$dest/"
      else
        cp -p "$src" "$TARGET/$dest"
      fi
      ;;
    tpl)
      [ -f "$TEMPLATE_DIR/$src" ] || fail "template $src does not exist under $TEMPLATE_DIR"
      sed -f "$SEDFILE" "$TEMPLATE_DIR/$src" > "$TARGET/$dest"
      [ ! -x "$TEMPLATE_DIR/$src" ] || chmod +x "$TARGET/$dest"
      ;;
    *)
      fail "unknown manifest entry: $entry"
      ;;
  esac
}

commit_section() {
  section=$1
  message=$2
  entries_of "$section" > "$LISTFILE"
  [ -s "$LISTFILE" ] || return 0
  while IFS= read -r entry; do
    place_entry "$entry"
  done < "$LISTFILE"
  git -C "$TARGET" add -A
  for file in $(git -C "$TARGET" ls-files -- '*.sh' '.husky/*'); do
    git -C "$TARGET" update-index --chmod=+x "$file"
  done
  git -C "$TARGET" commit -q -S -m "$message"
  COMMITS=$((COMMITS + 1))
}

commit_section tooling "chore: add repository tooling"
commit_section package "build: add plugin package and ci workflows"
commit_section rules-and-docs "docs: add rule files and docs scaffold"

[ "$COMMITS" -gt 0 ] || fail "the manifest has no entries"

if grep -rn '@@' "$TARGET" --exclude-dir=.git >/dev/null 2>&1; then
  grep -rn '@@' "$TARGET" --exclude-dir=.git >&2 || true
  fail "unreplaced template tokens were left in the new repository"
fi

git -C "$TARGET" branch dev
git -C "$TARGET" branch active-dev
git -C "$TARGET" switch -q active-dev

APP_HITS=$(grep -rlE 'apps/(backend|storefront|vendor-portal)' "$TARGET/.husky" "$TARGET/scripts" "$TARGET/.github" 2>/dev/null || true)
if [ -n "$APP_HITS" ]; then
  echo "[new-plugin-repo] warning: copied files mention app folders; generalise them in the app first:" >&2
  echo "$APP_HITS" >&2
fi

echo "[new-plugin-repo] created $TARGET on branch active-dev with $COMMITS signed commits and no remote."
echo "Next steps:"
echo "  1. cd $TARGET and run: pnpm install, then pnpm run guards"
echo "  2. Ask the owner to create the empty GitHub repository $OWNER/$NAME and add it as origin"
echo "  3. Apply the repository protection script from the app tooling before the first push"
