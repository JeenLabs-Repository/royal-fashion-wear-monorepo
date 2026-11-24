# Multivendor Store for India

A multivendor store for India built on the Gorgo Medusa DTC Starter. It is a pnpm workspace with a Medusa 2.22.7 backend and a Next.js 15 storefront. Customers see one store brand, the owner receives every order, and vendors work through a separate login.

## Status

The project is pre-launch. Releases carry `v0.x` tags, and no version is open to customers yet.

## Requirements

- [Node.js](https://nodejs.org/) 22.23.4 or newer. The `.nvmrc` file pins the version.
- [pnpm](https://pnpm.io/) 12.18.0 through [Corepack](https://nodejs.org/api/corepack.html).
- [Docker](https://www.docker.com/) with Compose for the development services.
- Postgres. The development stack reads the major from the `POSTGRES_VERSION` variable (fallback 17). Match it to the major your database host runs and never use `latest`.
- Redis. Production requires it. Development stays in memory unless you set `USE_REDIS=true`.

## Getting Started

1. Clone the repository and install dependencies. The install also sets up the git hooks.

   ```bash
   git clone <repository-url>
   cd <repository-folder>
   corepack enable
   pnpm install
   ```

2. Start Postgres, Redis and Mailpit for development.

   ```bash
   docker compose -f docker-compose.dev.yml up -d --wait
   ```

3. Create the environment files.

   ```bash
   cp apps/backend/.env.template apps/backend/.env
   cp apps/storefront/.env.template apps/storefront/.env.local
   ```

4. Run the migrations, seed the store and create the test accounts.

   ```bash
   cd apps/backend
   pnpm medusa db:migrate
   cd ../..
   pnpm backend:seed
   pnpm backend:seed:test
   ```

   `pnpm backend:seed:test` writes the untracked `TEST-CREDENTIALS.local.md` with the admin login and the publishable key.

5. Paste the publishable key from that file into `apps/storefront/.env.local`.

   ```bash
   # apps/storefront/.env.local
   NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=<key from TEST-CREDENTIALS.local.md>
   ```

6. Start both apps.

   ```bash
   pnpm dev
   ```

The backend runs on `http://localhost:9000` with the Admin at `/app`, and the storefront runs on `http://localhost:8000`. Mailpit catches every development email at `http://localhost:8025`. [docs/guides/getting-started.md](docs/guides/getting-started.md) has the full walkthrough.

## Commands

Run these from the repository root with pnpm.

| Command | Description |
|---|---|
| `pnpm dev` | Start the backend and the storefront together |
| `pnpm backend:dev` | Start the backend only |
| `pnpm storefront:dev` | Start the storefront only |
| `pnpm backend:seed` | Seed the store with the India region, English and the demo catalog |
| `pnpm backend:seed:test` | Create fake test accounts and write `TEST-CREDENTIALS.local.md` |
| `pnpm build` | Build both apps |
| `pnpm start` | Start both apps from their builds |
| `pnpm lint` | Lint every app that defines a `lint` task |
| `pnpm guards` | Run every guard script |
| `pnpm e2e` | Run the Playwright specs against a running stack |
| `pnpm e2e:install` | Install the Playwright browser |
| `pnpm release:prepare vX.Y.Z` | Generate the changelog section on `active-dev` |
| `pnpm release:tag vX.Y.Z` | Create a signed annotated tag on `main` |

`pnpm lint` runs `medusa lint` in the backend and `next lint` in the storefront, and the storefront half needs `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` in the environment.

## Testing

- **Backend suites.** Run `test:unit`, `test:integration:http` and `test:integration:modules` from `apps/backend`. The integration suites need a running Postgres.
- **Browser specs.** Playwright specs live in `e2e/specs`. Start the stack, then run `pnpm e2e`. See [docs/testing/playwright.md](docs/testing/playwright.md).
- **Guards.** `pnpm guards` runs every `scripts/check-*.mjs` script.
- **CI.** GitHub Actions runs lint, type checks, both builds, the backend tests, the guards, gitleaks, the signature check and the branch name check on every push. One job, `ci-gate`, summarises them.

## Deployment

CI builds the backend and storefront images from a signed release tag and pushes them to the GitHub container registry. The app host runs Dokploy and only pulls and runs those images. Postgres runs on a separate private host. [docs/guides/deploy-dokploy.md](docs/guides/deploy-dokploy.md) describes the setup, the first deploy and the production-like test.

## Documentation

- [docs/README.md](docs/README.md) indexes the guides, concepts, decision records and testing notes.
- [apps/backend/README.md](apps/backend/README.md) lists backend commands and variables.
- [apps/storefront/README.md](apps/storefront/README.md) lists storefront commands and variables.
- [docs/guides/backend-configuration.md](docs/guides/backend-configuration.md) lists the production variables and what the boot check rejects.
- [docs/guides/localization.md](docs/guides/localization.md) explains how to add a language.

## Working Agreement

Every commit is a signed Conventional Commit made on `active-dev`, and no plan or requirement number appears anywhere in git. The owner promotes `active-dev` to `dev`, and `dev` reaches `main` through a pull request. [CLAUDE.md](CLAUDE.md) and `.cursor/rules/` carry the full rules, and [docs/guides/commit-workflow.md](docs/guides/commit-workflow.md) shows the daily loop.

## License

MIT. See [LICENSE](LICENSE). This project derives from the Gorgo Medusa DTC Starter, and the license keeps its attribution.
