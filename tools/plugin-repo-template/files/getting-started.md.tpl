# Set Up the Plugin Repository

This guide takes you from a fresh clone of `@@PACKAGE@@` to a passing test run.

## Prepare Your Machine

1. Install the Node version in `.nvmrc`.
2. Enable pnpm through Corepack with `corepack enable`.
3. Run `pnpm install`. The `prepare` script installs the git hooks.
4. Set up SSH commit signing as the application repository setup guide describes. Every commit must be signed.
5. Switch to the working branch with `git switch active-dev`.

## Run the Checks

Run these from the repository root.

```text
pnpm run guards
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test:unit
```

The module integration tests need a Postgres server. Set these variables first.

```text
DB_HOST=localhost
DB_USERNAME=postgres
DB_PASSWORD=postgres
```

Then run `pnpm run test:integration:modules`.

## Try the Plugin in the Application

1. Open the application's local development guide and follow its plugin trial steps.
2. Run `pnpm run dev` here so each change rebuilds and reaches the linked application.
3. Stop the loop before you commit. Never commit a manifest that points at a local path.
