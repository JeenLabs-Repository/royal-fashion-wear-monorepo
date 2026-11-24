# Set Up the GitHub Repository

This guide publishes the three branches and turns on the protection rules. Only the owner does these steps. AI tools never push `dev` or `main`.

## Before You Start

You need the GitHub CLI signed in as the repository owner (`gh auth login`) and an SSH key that is already set up for signing.

## Steps

1. Create an empty GitHub repository. What GitHub can enforce depends on the plan. See Plans and Enforcement below.
2. Add your public SSH key to GitHub as a signing key. Open Settings, then SSH and GPG keys, then New SSH key, and choose the key type Signing Key.
3. Add the remote.

   ```sh
   git remote add origin git@github.com:<owner>/<repo>.git
   ```

4. Publish the three branches. The pre-push hook allows pushes to `main` and `dev` only when you set the promotion variable.

   ```sh
   OWNER_PROMOTION=1 git push -u origin main dev active-dev
   ```

5. Set the repository variables under Settings, then Secrets and variables, then Actions, then Variables. `POSTGRES_VERSION` is optional, defaults to 17 and should match the Postgres major your database host runs. The deployment guide names the image build variables.
6. Wait for the first CI run to finish on each branch. GitHub only offers the `ci-gate` check name for protection after it has run once.
7. Apply the settings.

   ```sh
   sh scripts/setup-branch-protection.sh <owner>/<repo>
   ```

   The script always allows only the merge-commit method for pull requests. Then it reads the repository's rulesets once to learn whether your plan can enforce rules on the server. Two outcomes are possible.

   - The plan allows rulesets. The script creates or updates `protect-main` and `protect-dev`, reads the rules back and prints `ENFORCEMENT: SERVER`.
   - The plan does not allow rulesets, which is what a private repository on the free plan gets. The script prints the exact manual rules and `ENFORCEMENT: LOCAL ONLY`, and changes nothing else.
8. Check the result for the outcome you got.

   If the script printed `ENFORCEMENT: SERVER`, read the rules back.

   ```sh
   gh api repos/<owner>/<repo>/rules/branches/main --jq '.[].type'
   gh api repos/<owner>/<repo>/rules/branches/dev --jq '.[].type'
   ```

   Then try a direct push to `main` from a scratch commit. GitHub must reject it.

   If the script printed `ENFORCEMENT: LOCAL ONLY`, there is nothing to read back. Write the outcome and the commit you published into the release checklist. That commit is the baseline for the weekly audit.

## Plans and Enforcement

GitHub enforces branch rules on a paid plan or on a public repository. A private repository on the free plan cannot enforce rulesets or classic branch protection, so no rule below is checked by GitHub there.

| Where | What enforces the rules |
|---|---|
| Free plan, private repository | The local hooks, the CI checks and your discipline. `ci-gate` runs but cannot block a merge. |
| Paid plan, or a public repository | The rulesets from the script, plus the same hooks and CI checks. |

The local hooks are the commit-msg hook, the pre-commit hook with gitleaks and the pre-push hook with its signature and branch-name checks. The risk you accept on the free plan is that a mistaken or compromised direct push to `main` is not blocked on the server. The audit below is how you find one.

## Merge Rules You Follow by Hand

- Merge into `dev` and into `main` only through a pull request, after the `ci-gate` check is green, using "Create a merge commit".
- After the first publication, never push to `dev` or `main` directly. Never force push and never delete either branch.
- Every commit is signed.
- On the free plan GitHub lets you press merge on a red check. Look at `ci-gate` before you merge.

## Weekly Audit

Run this once a week from a clone. Every command must succeed. Replace `<baseline>` with the commit you published first, which you wrote into the release checklist.

```sh
git fetch origin
STRICT=1 sh scripts/verify-signatures.sh origin/main
STRICT=1 sh scripts/verify-signatures.sh origin/dev
git log --first-parent --no-merges --oneline <baseline>..origin/main
git log --first-parent --no-merges --oneline <baseline>..origin/dev
```

The two signature checks must print no failure. The two `git log` listings must be empty, because every change after the first publication arrives as a pull request merge commit. A line in a listing is a direct push. Find out who made it and why, and record it.

## Promotion Routine

1. Open a pull request from `active-dev` to `dev`. Wait for a green `ci-gate`, then choose "Create a merge commit".
2. Open a pull request from `dev` to `main`. Fill the notes template, wait for a green `ci-gate`, then choose "Create a merge commit".
3. After the merge, update `dev` and `active-dev` from `main` so the branches do not drift.

## Hotfixes and Drift

Branch a hotfix from `main` and merge it through a pull request. Merge `main` back into `dev` through a pull request and into `active-dev` locally right away.

## Upgrade Options

You can make GitHub enforce these rules later. The script already knows how. Each option has a cost, and this guide does not choose for you.

- **GitHub Team for the private repository.** It costs a monthly fee per user. It enables rulesets and classic protection on the private repository, with no change to how the code is hosted.
- **Make the repository public.** It costs nothing in fees. It enables the same rules, and it makes the source code visible to everyone, so only choose it if you accept that.
- **Self-host a Git server later.** It removes the dependence on the GitHub plan and costs you the upkeep of the server. You would have to rebuild the hooks, the CI and these rules there.

After any of them, run `sh scripts/setup-branch-protection.sh <owner>/<repo>` again and check for `ENFORCEMENT: SERVER`.

## Classic Protection Instead of Rulesets

Use these commands only where the plan allows classic protection but you prefer it to rulesets. They fail on a private repository on the free plan. Run them as the repository owner after the first CI run has finished on each branch, so GitHub knows the `ci-gate` check name. Replace `<owner>/<repo>` with your repository. The rules are the same as the rulesets: strict for `main`, and an admin bypass for `dev` that applies only once your plan can enforce rules.

First allow only the merge-commit method, which preserves signed commits.

```sh
gh api -X PATCH repos/<owner>/<repo> -F allow_merge_commit=true -F allow_squash_merge=false -F allow_rebase_merge=false
```

Then protect `main` strictly. Signed commits, a pull request and a passing `ci-gate` are required, and the rules apply to admins too.

```sh
gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["ci-gate"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
gh api -X POST repos/<owner>/<repo>/branches/main/protection/required_signatures
```

Then protect `dev` with an admin bypass. Admins are not bound by the rules (`enforce_admins` is false), which lets you push the signed promotion merge. Everyone else needs a passing `ci-gate` and signed commits, and nobody can force push or delete the branch.

```sh
gh api -X PUT repos/<owner>/<repo>/branches/dev/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["ci-gate"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
gh api -X POST repos/<owner>/<repo>/branches/dev/protection/required_signatures
```

Read the result back.

```sh
gh api repos/<owner>/<repo>/branches/main/protection --jq '[.required_signatures.enabled, .enforce_admins.enabled] | @csv'
gh api repos/<owner>/<repo>/branches/dev/protection --jq '[.required_signatures.enabled, .enforce_admins.enabled] | @csv'
```

Expect `true,true` for `main` and `true,false` for `dev`. On the free plan with a private repository GitHub enforces none of this, so keep the local hooks and the CI signature check, follow the merge rules above, and run the weekly audit.
