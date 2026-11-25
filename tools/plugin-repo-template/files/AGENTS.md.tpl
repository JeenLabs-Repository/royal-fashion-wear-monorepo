# @@NAME@@

This repository holds `@@PACKAGE@@` (@@DESCRIPTION@@). The store application consumes it as an exact pinned version from the private registry. You never edit the application from here.

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Installs dependencies and the git hooks |
| `pnpm run build` | Builds the plugin into `.medusa/server` |
| `pnpm run dev` | Rebuilds on change and pushes the build to a linked application |
| `pnpm run publish:local` | Publishes the build to the local plugin store for a trial in the application |
| `pnpm run test:unit` | Runs the unit tests under `src/**/__tests__/*.unit.spec.ts` |
| `pnpm run test:integration:modules` | Runs the module integration tests against Postgres |
| `pnpm run lint` | Lints the source |
| `pnpm run typecheck` | Type-checks without emitting |
| `pnpm run guards` | Runs every repository guard |
| `pnpm run db:generate` | Generates a migration for a changed data model |

## Working Agreement

- Read the local skills before the web. The Medusa backend skill is at `.claude/skills/building-with-medusa/SKILL.md`. Read it before any backend work.
- Follow the dev loop in `docs/guides/getting-started.md`. Test with the real commands above, never from memory.
- Write conventional commit messages that describe the change in plain words. Never put plan, phase, task, decision or requirement numbers in a commit message, a code comment, a test name or a document.
- Sign every commit. Do not disable signing for any reason.
- Keep three branches, `main`, `dev` and `active-dev`. Do all work on `active-dev`. Never push `dev` or `main`; they move by signed merge and pull request.
- Land tests and docs in the same change as the code.

## Plugin Rules

- Import nothing from the application. No relative path leaves this repository and no application package is imported.
- Export everything the application may use from `src/public.ts` and document it in `docs/`. Nothing else is public.
- Never read a settings card option from the environment. Read options at call time through the Integration Module so a change applies without a restart.
- Mark every secret option `secret: true` with `control: "secret"`, and give every required string option `minLength: 1`.
- Release a new option as a minor version. Release a rename, a removal or a changed default as a major version.
- Pin Medusa, the Gorgo integration module and all tooling at exact versions with no range.
- Keep a migration for every data model change, generated with `pnpm run db:generate` and committed with the change.

## Writing Rules

- Use active voice and second person.
- Use no em dashes and no asides set off with a pair of them.
- Use a colon only before a list on its own lines.
- Write headings as Title Case statements, never as questions.
