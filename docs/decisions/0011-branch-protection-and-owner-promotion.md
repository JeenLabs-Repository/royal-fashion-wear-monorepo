# 0011 Branch Protection and Owner Promotion

Status: accepted

Date: 2026-11-24

## Context

The owner is on the free GitHub plan with a private repository. On that plan GitHub refuses rulesets and classic branch protection for the repository, so it enforces no branch or merge rule on the server. The rules still matter, so the project enforces them locally and in CI.

## Decision

Keep the rules as the owner's agreement and enforce them without GitHub. The local hooks (commit-msg, pre-commit with gitleaks, pre-push signature and branch checks) and the CI checks are the enforcement. The CI job `ci-gate` runs on pull requests and pushes but cannot block a merge. The owner merges into `dev` and `main` only through a pull request after `ci-gate` is green, never pushes to them directly, and runs the weekly audit in the repository setup guide.

The rules that apply on the server if the plan is upgraded are these. `dev` gives repository admins an exception so a local signed merge can still be pushed. `main` has no exception, needs signed commits and a pull request with merge commits, and needs `ci-gate` green. The setup script applies them as soon as the plan allows it.

## Accepted Risk

A mistaken or compromised direct push to `main` is not blocked on the server. The owner accepted this, and the weekly audit is how a direct push is found.

## Consequences

AI tools hold no admin credentials, and the pre-push hook also refuses their pushes to `dev` and `main`. The owner keeps the habit of checking `ci-gate` before pressing merge, because GitHub allows a merge on a red check on this plan.

Undo cost: reversible. An upgrade only means running the setup script again.

## Upgrade Options

None is chosen. The owner decides when the cost is worth it.

- GitHub Team for the private repository.
- Make the repository public, if the owner accepts public code.
- Self-host a Git server later.

## Alternatives Considered

- Push the promotion to `dev` from the owner's machine as a local signed merge. That needs the admin exception on `dev` once rules are enforced, and on the free plan it is a direct push that nothing checks. Rejected for now. GitHub signs the merge commit of a pull request with its own key, which the signature check treats as a warning for merge commits only.
- Drop the status check on `dev`. Rejected because `dev` is the production-build test target and should hold only checked work.
