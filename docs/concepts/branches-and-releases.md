# Branches and Releases

This page explains the three long-lived branches, how work moves between them and how releases are tagged.

## The Three Branches

| Branch | Role | Who changes it |
|---|---|---|
| `main` | Production. What runs live. | Only a pull request from `dev`, opened and merged by the owner |
| `dev` | Verified work and the production-build test target | Promotions from `active-dev` |
| `active-dev` | All AI work and testing | Claude and Cursor, in small signed conventional commits |

AI tools commit on `active-dev` only. They never push `dev` or `main`, never merge to `main` and never force-push.

## Promotion

The owner promotes `active-dev` to `dev` with a signed `--no-ff` merge made locally, so the owner's key signs the merge. Before the merge, all of these must be true.

- Tests pass.
- Playwright specs pass and the UI has been checked.
- Docs are updated in the same change.
- Lint, type-check and both builds pass.
- Fixup commits are squashed with `git rebase --autosquash`.
- No secret or test credential is staged.

The owner opens a pull request from `dev` to `main` by hand and merges it with the "Create a merge commit" method. Squash and rebase merges create commits that the owner's key did not sign. Before the pull request, the production build runs from `dev` in a production-like setup and gets tested there, GUI included.

## Hotfixes and Drift

A hotfix branches from `main` and goes through a pull request to `main`. The owner then merges `main` back into `dev` and `active-dev` at once so the branches do not drift. After every release, merge `main` into `dev` and `dev` into `active-dev`.

## Versions and Tags

Releases use plain semver on signed annotated tags. Use `v0.x` before launch and `v1.0.0` at launch. After that, each product stage gets one major number. Minor releases are smaller feature or maintenance releases. Patch releases are fixes. The changelog is generated from Conventional Commits.

## Why Nothing in Git Points at Planning Documents

Planning documents are not stored in this repository, so a phase, plan, task or requirement number in a branch name, commit, tag or comment would point at nothing. Name things by what they are, for example `feat/vendor-invites`. Hooks and a CI guard reject numbering.
