#!/bin/sh
# Applies the merge settings and, where the GitHub plan allows it, branch rulesets.
# On a plan that cannot enforce rules on the server (a private repository on the
# free plan) it applies only the merge settings, prints the exact manual rules and
# says that enforcement is local only.
# Run by the owner only. Safe to run again: rulesets are found by name and updated.
# Usage: sh scripts/setup-branch-protection.sh <owner/repo> [--yes]
# GH_BIN names the GitHub CLI (default gh). The stub guard sets it.
set -eu

GH="${GH_BIN:-gh}"

print_manual_rules() {
  cat <<'RULES'

GitHub cannot enforce branch or merge rules for this repository on this plan.
Enforcement is local only. The local hooks (commit-msg, pre-commit with gitleaks,
pre-push signature and branch checks) and the CI checks are the enforcement. The
CI job ci-gate still runs on pull requests and pushes, but it cannot block a merge.

Rules you follow by hand:

  main (strict)
    - change it only through a pull request from dev, merged with "Create a merge commit"
    - merge only after the ci-gate check is green
    - every commit is signed
    - never push to main directly, never force push, never delete it
  dev (admin bypass applies only if the plan is upgraded)
    - change it only through a pull request from active-dev, merged with "Create a merge commit"
    - merge only after the ci-gate check is green
    - every commit is signed
    - never push to dev directly, never force push, never delete it

The first publication of the branches is the only direct push to main and dev.
The accepted risk: a mistaken or compromised direct push to main is not blocked on the server.

Weekly audit (run from a clone, expect every command to succeed and both listings to be empty):
  git fetch origin
  STRICT=1 sh scripts/verify-signatures.sh origin/main
  STRICT=1 sh scripts/verify-signatures.sh origin/dev
  git log --first-parent --no-merges --oneline <baseline>..origin/main
  git log --first-parent --no-merges --oneline <baseline>..origin/dev
  (<baseline> is the commit of the first publication, recorded in the release checklist)

If you upgrade the plan later (GitHub Team for the private repository, or make the
repository public), run this script again and it will create the rulesets.
RULES
}

usage() {
  echo "usage: sh scripts/setup-branch-protection.sh <owner/repo> [--yes]" >&2
  exit 2
}

repo="${1:-}"
[ -n "$repo" ] || usage
printf '%s\n' "$repo" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || usage

$GH auth status >/dev/null 2>&1 || {
  echo "gh is not signed in. Run: gh auth login" >&2
  exit 1
}

plan=$($GH api user --jq '.plan.name' 2>/dev/null || true)
private=$($GH api "repos/$repo" --jq '.private' 2>/dev/null || true)
echo "Account plan: ${plan:-unknown}. Repository private: ${private:-unknown}."

echo "This will change settings on $repo:"
echo "  - allow only the merge-commit method for pull requests"
echo "  - create or update the rulesets protect-main and protect-dev if the plan allows rulesets"
echo "  - otherwise print the manual rules and say that enforcement is local only"
if [ "${2:-}" != "--yes" ]; then
  printf 'Type yes to continue: '
  read -r answer
  [ "$answer" = "yes" ] || {
    echo "Cancelled."
    exit 1
  }
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Merge settings work on every plan, and a wrong repository name fails here.
$GH api -X PATCH "repos/$repo" \
  -F allow_merge_commit=true \
  -F allow_squash_merge=false \
  -F allow_rebase_merge=false >/dev/null
echo "Merge settings applied: only the merge-commit method is allowed."

# One read tells whether this plan can enforce rules on the server. A private
# repository on the free plan answers 403 (some plans answer 404).
if probe=$($GH api "repos/$repo/rulesets" 2>&1); then
  :
else
  case "$probe" in
    *"HTTP 403"*|*"HTTP 404"*|*Upgrade*)
      echo "Rulesets are not available for $repo on this plan. The API said: $probe"
      print_manual_rules
      echo "ENFORCEMENT: LOCAL ONLY"
      exit 0
      ;;
    *)
      echo "Could not read the rulesets of $repo: $probe" >&2
      exit 1
      ;;
  esac
fi

cat > "$tmp/main.json" <<'EOF'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_signatures" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [{ "context": "ci-gate" }]
      }
    }
  ]
}
EOF

cat > "$tmp/dev.json" <<'EOF'
{
  "name": "protect-dev",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/dev"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_signatures" },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "ci-gate" }]
      }
    }
  ]
}
EOF

apply_ruleset() {
  name="$1"
  file="$2"
  id=$($GH api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")
  if [ -n "$id" ]; then
    $GH api -X PUT "repos/$repo/rulesets/$id" --input "$file" >/dev/null
    echo "Updated ruleset $name"
  else
    $GH api -X POST "repos/$repo/rulesets" --input "$file" >/dev/null
    echo "Created ruleset $name"
  fi
}

# Read the active rules back and compare them with the rule types we sent.
check_branch() {
  branch="$1"
  file="$2"
  actual=$($GH api "repos/$repo/rules/branches/$branch" --jq '.[].type' | sort -u)
  for type in $(grep -o '"type": *"[a-z_]*"' "$file" | cut -d'"' -f4 | sort -u); do
    printf '%s\n' "$actual" | grep -qx "$type" || {
      echo "Rule $type is not active on $branch." >&2
      exit 1
    }
  done
  echo "Verified rules on $branch"
}

apply_ruleset protect-main "$tmp/main.json"
apply_ruleset protect-dev "$tmp/dev.json"
check_branch main "$tmp/main.json"
check_branch dev "$tmp/dev.json"
echo "ENFORCEMENT: SERVER (rulesets are active on main and dev)"
