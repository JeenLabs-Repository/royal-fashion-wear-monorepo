# Get the Repository Running

This guide takes a fresh machine to a running backend and storefront.

## Before You Start

You need Git 2.34 or newer, Docker with Compose, and a terminal. You do not install pnpm or Node by hand. Corepack and your Node version manager provide them.

## Steps

1. Install Node 22.23.4 or newer. The `.nvmrc` file pins the version, so `nvm install` and `nvm use` read it.
2. Turn on pnpm through Corepack at the pinned version.

   ```sh
   corepack enable
   corepack prepare pnpm@10.11.1 --activate
   pnpm -v
   ```

3. Clone the repository, switch to `active-dev` and install packages.

   ```sh
   pnpm install
   ```

   The `prepare` script installs the commit hooks during this step. The hooks reject commit messages that are not Conventional Commits and stop commits that contain secrets.
4. Set up SSH commit signing. The repository setup guide describes it. Every commit must be signed.
5. Start Postgres, Redis and a mail catcher with the dev stack that this repository provides. The Postgres major comes from the `POSTGRES_VERSION` variable (fallback 17).

   ```sh
   docker compose -f docker-compose.dev.yml up -d --wait
   ```

   The mail catcher shows every email the backend sends at `http://localhost:8025`.
6. Copy the environment templates. Both target files are ignored by git.

   ```sh
   cp apps/backend/.env.template apps/backend/.env
   cp apps/storefront/.env.template apps/storefront/.env.local
   ```

   The templates name every variable. Read the comment above each one before you change it.
7. Create the database tables from `apps/backend`.

   ```sh
   cd apps/backend
   pnpm medusa db:migrate
   cd ../..
   ```

8. Seed the store, then create the fake test accounts.

   ```sh
   pnpm backend:seed
   pnpm backend:seed:test
   ```

   The second command writes the untracked `TEST-CREDENTIALS.local.md` at the repository root with the demo logins and the publishable key.
9. Copy the publishable API key into `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` in `apps/storefront/.env.local`. The credentials file lists the key, and the Admin lists it under Settings.
10. Start both apps.

    ```sh
    pnpm dev
    ```

## What You Should See

- `http://localhost:9000/health` answers OK.
- `http://localhost:8000` redirects to `/en`.
- The Admin opens at `http://localhost:9000/app`.

## Related Guides

The repository setup guide covers signing and the GitHub setup. The commit workflow guide covers commits, fixups and hooks. The Playwright guide covers browser tests and test data. These guides arrive with the tooling and are named here in plain text until they exist.
