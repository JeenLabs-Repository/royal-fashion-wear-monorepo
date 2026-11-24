# Commit and Fix Work

This guide covers the loop for one change, the commit format, signing, fixups and the hooks.

## The Loop

1. Write the code on `active-dev`.
2. Test it and fix what breaks.
3. Retest in a real browser with a Playwright spec.
4. Update the docs in the same change.
5. Commit one logical change at a time. Each commit must build on its own. Commit backend changes before the storefront changes that depend on them.

## Commit Format

Use `<type>[scope]: <summary>`. The types are feat, fix, docs, style, refactor, perf, test, build, ci, chore and revert. Write the summary in the imperative, in lower case, without a trailing period, in about 72 characters or fewer. A scope names code, such as `vendor-api` or `storefront`.

Good examples:

- `feat: add vendor invite route`
- `fix(storefront): stop caching authenticated cart requests`
- `refactor(vendor-api): move ownership check into one helper`
- `test: add cross-vendor access matrix`
- `docs: explain how order routing moves reservations`

Hooks reject these kinds of messages. A scope made of two numbers, a phase, plan, task or wave label with a number, a requirement code, a decision code, a message with no type, a summary that says nothing about what changed, and a summary that starts with a capital letter.

## Check the Signature

Every commit is signed. After you commit, run this and look for a good signature.

```sh
git log --show-signature -1
```

If signing fails, stop and ask the owner. Never turn signing off for a single commit.

## Fix an Earlier Commit

Mark a fix for an earlier commit while you work, then squash before the owner promotes.

```sh
git commit --fixup=<sha>
sh scripts/squash-fixups.sh <base>
```

The script works without an editor, refuses to run on `main` or `dev`, refuses to touch commits that are already on `dev`, and checks that every commit is still signed afterwards. It never pushes.

## What the Hooks Do

- The commit-msg hook rejects messages that are not Conventional Commits or that carry planning numbers.
- The pre-commit hook scans staged changes for secrets and refuses `.env` files, the test credentials file and planning files, even when you add them with `git add -f`. It stops the commit when `gitleaks` is not installed.
- The pre-push hook refuses bad branch names, unsigned commits and pushes to `main` or `dev`.

Never skip a hook. Fix what it reports. On a plan where GitHub cannot enforce branch rules, these hooks and the CI checks are the enforcement, so a skipped hook leaves nothing else in the way.

## Hooks in GUI Clients

Cursor and other GUI tools start git without your shell profile. If a hook cannot find `node`, create `~/.config/husky/init.sh` that loads your version manager, for example `export NVM_DIR="$HOME/.nvm"` followed by `. "$NVM_DIR/nvm.sh"`.

## Owner-Only Pushes

`OWNER_PROMOTION=1` lets a push to `main` or `dev` through the pre-push hook. Only the owner sets it, and only for the first publication of the branches. After that you change `dev` and `main` through pull requests and never push to them directly.
