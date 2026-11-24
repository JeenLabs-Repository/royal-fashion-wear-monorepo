# AGENTS.md

## Overview

This repository is the project's own code. It holds a multivendor store for India, built on a snapshot of the
Gorgo Medusa DTC Starter (MIT license, no remote to the starter, history starts here). It is a pnpm
workspace holding a Medusa 2 backend (`@dtc/gorgo-medusa-backend`) and a Next.js 15 storefront
(`@dtc/gorgo-medusa-storefront`).

The backend refuses to start in production with an unset, placeholder or short secret, so no weak
default can reach a live server. [docs/guides/backend-configuration.md](docs/guides/backend-configuration.md)
lists every production variable and what the boot check rejects.

## Rule Files

Four more sources of rules and context sit next to this file. Read them before you change an area they cover.

- [CLAUDE.md](CLAUDE.md) imports this file and adds the project rules for Claude
- `.cursor/rules/*.mdc` carries the same agreement for Cursor, split by topic
- [PRODUCT.md](PRODUCT.md) holds the product brief for design and copy work
- [docs/](docs) holds task guides, concept pages and the decision records in `docs/decisions/`

Where this file and a rule file differ, the rule file wins, and the difference is a bug to fix in
this file.

## Where the Documentation Lives

The READMEs and `docs/` are the reference for installation, environment variables, commands,
testing and deployment. Read them before answering a question about any of those, and update them in
the same commit as the code they describe.

- [README.md](README.md) covers the repository and the getting-started walkthrough
- [apps/backend/README.md](apps/backend/README.md) covers backend commands and every backend variable
- [apps/storefront/README.md](apps/storefront/README.md) covers storefront commands and every
  storefront variable
- [docs/README.md](docs/README.md) indexes the guides, concepts, decisions and testing notes

## Directory Structure

```text
.
├── apps/
│   ├── backend/                      # Medusa application, Admin and transactional emails
│   │   ├── medusa-config.ts          # modules, plugins, feature flags, all env-driven
│   │   ├── eslint.config.mjs         # read by medusa lint, develop and build
│   │   ├── jest.config.js            # suites split by TEST_TYPE
│   │   ├── integration-tests/        # setup.js, helpers and the HTTP specs
│   │   ├── scripts/                  # copy-migration-data.js, runs after medusa build
│   │   └── src/
│   │       ├── admin/                # scaffold for Admin extensions and their i18n
│   │       ├── api/                  # custom store and admin routes, file-based
│   │       ├── emails/               # React Email templates, their i18n and lib/
│   │       │                         # lib/styles.ts is the one style sheet for all of them
│   │       ├── jobs/                 # scheduled jobs
│   │       ├── lib/                  # plain helpers, including the production boot check
│   │       ├── links/                # module links
│   │       ├── migration-scripts/    # initial-data-seed.ts, test-data-seed.ts, JSON under data/
│   │       ├── modules/              # smtp-notification provider
│   │       ├── subscribers/          # transactional emails and storefront revalidation
│   │       └── workflows/            # workflows and steps
│   └── storefront/                   # Next.js 15 storefront
│       ├── messages/                 # next-intl UI catalogs
│       ├── next.config.js            # standalone output, next-intl plugin, image hosts
│       ├── tailwind.config.js        # Medusa UI preset plus a hand-kept content allowlist
│       ├── public/flags/             # vendored country flags
│       └── src/
│           ├── app/                  # [locale] routes, api/, llms.txt, sitemap, robots
│           ├── i18n/                 # locale list, routing, request config, navigation
│           ├── lib/                  # data loaders, constants, hooks, utils
│           ├── middleware.ts         # locale and region resolution
│           ├── modules/              # feature areas: store, products, cart, checkout, account…
│           └── styles/globals.css    # Tailwind entry and the few global overrides
├── .claude/skills/                   # local agent skills, read before the matching work
├── .cursor/rules/                    # Cursor rules
├── .github/                          # CI workflow, image workflow, pull request template
├── .husky/                           # commit-msg, pre-commit and pre-push hooks
├── deploy/                           # production compose file and environment template
├── docs/                             # guides, concepts, decisions and testing notes
├── e2e/                              # Playwright specs and helpers
├── scripts/                          # guards (check-*.mjs), release and verification scripts
├── docker-compose.dev.yml            # development Postgres, Redis and Mailpit
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

The Medusa convention directories (`admin`, `api`, `jobs`, `links`, `modules`, `subscribers`,
`workflows`) each keep a `README.md` from the framework describing the primitive they hold. Read the
local one before adding a file there. `emails`, `lib` and `migration-scripts` are this project's own
and carry no such README.

Those seven names belong to Medusa's loaders, and `subscribers` is walked recursively. Every `.ts`
file under it is imported at boot and validated as a subscriber, so a helper parked anywhere inside
warns on every start. Code that is not one of the seven primitives belongs in a sibling directory of
its own, the way `emails`, `lib` and `migration-scripts` already do.

## Package Manager

pnpm 12.18.0 only, pinned by `packageManager` in the root [package.json](package.json). Node
22.23.4 or newer, pinned by [.nvmrc](.nvmrc) and by `engines` in every `package.json`. There is one
lockfile, `pnpm-lock.yaml`, and installs in CI and in the images use `--frozen-lockfile`. Do not add
a second package manager or a second lockfile.

When the pnpm on `PATH` is a different major, run `corepack pnpm <command>`. A mismatched major asks
to delete and reinstall every `node_modules` in the workspace.

Medusa packages stay at exactly 2.22.7 together, `@gorgo/medusa-integration` stays pinned, and no
dependency uses `latest` or a caret on those packages. Node stays at 22.23.4 or newer in CI and in
the images. `scripts/check-pins.mjs` enforces all of it.

## Commands

Run these from the repository root.

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies and the git hooks |
| `pnpm dev` | Start both apps |
| `pnpm backend:dev` | Backend only, on `http://localhost:9000`, Admin at `/app` |
| `pnpm storefront:dev` | Storefront only, on `http://localhost:8000` |
| `pnpm backend:seed` | Seed the store with the India region, English and the demo catalog |
| `pnpm backend:seed:test` | Create fake test accounts and write the untracked `TEST-CREDENTIALS.local.md` |
| `pnpm build` | Build both apps |
| `pnpm lint` | Lint both apps |
| `pnpm guards` | Run every guard script under `scripts/check-*.mjs` |
| `pnpm e2e` | Run the Playwright specs against a running stack |
| `pnpm e2e:install` | Install the Playwright browser |
| `pnpm release:prepare vX.Y.Z` | Generate the changelog section on `active-dev` |
| `pnpm release:tag vX.Y.Z` | Create a signed annotated tag on `main` |
| `docker compose -f docker-compose.dev.yml up -d --wait` | Start Postgres, Redis and Mailpit for development |

Two of these come with a catch. `pnpm lint` covers both apps, `medusa lint` in the backend and
`next lint` in the storefront, and the storefront half loads `next.config.js` and exits when
`NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` is absent from the environment. `pnpm test` runs the `test` task
of each app that defines one, and neither app does. The backend suites are `test:unit`,
`test:integration:http` and `test:integration:modules`, run from `apps/backend`, and CI runs them
against a Postgres service container. Browser specs run with `pnpm e2e`.

## Verifying Your Work

The storefront typechecks and lints clean, and `next build` enforces both. Keep it that way, because
a single new finding fails the build rather than joining a backlog.

```bash
pnpm -C apps/storefront exec tsc --noEmit   # types
pnpm -C apps/storefront run lint            # lint
pnpm -C apps/storefront run build           # runs both, then builds
```

[next.config.js](apps/storefront/next.config.js) used to carry `typescript.ignoreBuildErrors` and
`eslint.ignoreDuringBuilds`. Both are gone. Do not add them back to get a change through, and do not
reach for `eslint-disable` where the finding is real. The repository has seven deliberate
`react-hooks/exhaustive-deps` suppressions, each on an effect whose dependency list is intentionally
narrow. A new one needs the same kind of reason written next to it.

The backend lints clean too, through `medusa lint` and
[eslint.config.mjs](apps/backend/eslint.config.mjs). Mind that `medusa develop` runs the same check
before it starts and refuses to boot on a lint error, so a lint mistake there breaks `pnpm dev` as
well as CI. `medusa build` runs it as well, but only reports and carries on.

```bash
pnpm -C apps/backend run lint                # medusa lint
pnpm -C apps/backend exec tsc --noEmit       # types
pnpm -C apps/backend run test:unit           # unit tests
```

Before you hand work over, also run the guards and the browser specs.

```bash
pnpm guards
pnpm e2e
```

After dev testing, run the production build and test it in a production-like stack on the compute
engine with `sh scripts/local-prod.sh up`. [docs/guides/deploy-dokploy.md](docs/guides/deploy-dokploy.md)
describes that test. The server never builds. It pulls images that CI built.

## Conventions

### Formatting Differs Between the Two Apps

The storefront runs Prettier with `semi: false`
([.prettierrc.json](apps/storefront/.prettierrc.json)). The backend keeps semicolons and has no
Prettier config of its own. Match the file you are editing instead of reformatting it. There is no
repo-wide formatter and no formatting gate, so a reformatting sweep is pure noise in a diff, and a
formatting change gets its own commit.

Lint rules for the storefront live in [.eslintrc.json](apps/storefront/.eslintrc.json), extending
`next/core-web-vitals` and `next/typescript`. A binding that is unused on purpose takes a leading
underscore.

### Storefront

- Server components by default. Reach for `"use client"` only when you need state, effects, browser
  APIs or Framer Motion.
- Data loaders belong in [src/lib/data](apps/storefront/src/lib/data), as `"use server"` modules
  calling the `sdk` from [lib/config.ts](apps/storefront/src/lib/config.ts). Put a new fetch there
  rather than in a component.
- A request that carries an authorization header never uses `force-cache`.
  `scripts/check-auth-cache.mjs` fails CI when one does.
- Import through the `@lib/*`, `@modules/*` and `@i18n/*` aliases from
  [tsconfig.json](apps/storefront/tsconfig.json).
- Kebab-case directory names under `src/modules`, with the component itself as `index.tsx`.
- Never hardcode a user-facing string. See Localization below.
- Every `NEXT_PUBLIC_` value is public and baked in at build time. Never put a secret in one.

### Backend

- Medusa resolves subscribers, jobs, links, modules and API routes from the filesystem, so a new file
  in the right directory registers itself.
- [medusa-config.ts](apps/backend/medusa-config.ts) calls the production boot check in
  `src/lib/production-config.ts`. Redis, the production secrets and the Gorgo telemetry switch are
  mandatory in production and enforced at boot. SMTP and S3 stay env-activated, and development stays
  in memory unless you set `USE_REDIS=true`.
- The Integration Module is registered in `medusa-config.ts` with a `providers` array that has no
  entries until the first provider lands. Registering a provider means editing the config and
  restarting the backend, and every provider gets a settings descriptor so it appears under Settings,
  Integrations.

## Localization

One storefront locale, `en`, declared once in [src/i18n/config.ts](apps/storefront/src/i18n/config.ts).
The language plumbing stays so adding a language is a catalog and config change. It consists of the
cookie-based locale, `localePrefix` set to `never`, the locale list, the label map and the language
switcher. [docs/guides/localization.md](docs/guides/localization.md) lists the steps for a new
language and what to restore for a language that needs a different text direction.

Three sets of catalogs have to stay in step, each holding one file per locale.

| Set | Path | Read by |
|---|---|---|
| Storefront UI | [apps/storefront/messages](apps/storefront/messages) | next-intl |
| Emails | [apps/backend/src/emails/i18n/messages](apps/backend/src/emails/i18n/messages) | React Email templates |
| Seed | [apps/backend/src/migration-scripts/data/i18n/json](apps/backend/src/migration-scripts/data/i18n/json) | the seed script, as catalog translations |

Adding one key means adding it to every file of that set, with a real translation rather than the
English string copied across. A missing key fails at runtime, not at build time, so
`node scripts/check-catalog-parity.mjs` compares the locale list with all three sets and their keys.
It runs with the other guards in CI.

Two pieces of locale plumbing are worth knowing before you touch either.

Routing does not use next-intl's own prefixing. [routing.ts](apps/storefront/src/i18n/routing.ts)
sets `localePrefix` to `never`, and [middleware.ts](apps/storefront/src/middleware.ts) does the work
by hand. It resolves the locale from the URL, the `_medusa_locale` cookie or `Accept-Language`,
redirects a prefix-less path to `/{locale}/…`, and passes the locale to next-intl through the
`X-NEXT-INTL-LOCALE` header. [request.ts](apps/storefront/src/i18n/request.ts) falls back to the
cookie when there is no locale in the request.

Translated catalog content comes from an `x-medusa-locale` header that
[lib/config.ts](apps/storefront/src/lib/config.ts) attaches to every SDK call. A route that is not
locale-scoped has to use the `fetchWithoutLocale` export instead, otherwise whichever language
happens to fill the cache first is served to every visitor. [llms.txt](apps/storefront/src/app/llms.txt/route.ts)
is the worked example.

## Things That Break Silently

**The production boot check.** With `NODE_ENV=production` the backend exits on start when a secret is
unset, a placeholder or shorter than 32 characters, when cookies are not secure, when Redis is
missing, or when telemetry is not off. `medusa build` is exempt, so images build without secrets.

**The `NODE_ENV` rule for builds.** Only the runtime stage of an image sets `NODE_ENV=production`.
A build stage that sets it makes `medusa build` run the boot check without secrets.
`scripts/check-dockerfiles.mjs` guards this.

**The test-data seed.** `pnpm backend:seed:test` refuses to run when `NODE_ENV` is `production` or
when `TEST-CREDENTIALS.local.md` is not ignored by git. Demo credentials never go to production.

**The Tailwind content allowlist.** [tailwind.config.js](apps/storefront/tailwind.config.js) lists
the `@medusajs/ui` components this storefront actually imports, one glob each, because scanning the
whole kit cost about 19 KB of unused CSS. Importing a new primitive from `@medusajs/ui` means adding
its glob there. Skip that and the component renders unstyled, with no error anywhere.

**The middleware matcher.** `config.matcher` in [middleware.ts](apps/storefront/src/middleware.ts)
excludes `/api`, so a route handler under `src/app/api` gets no locale prefix and no country cookie
resolution. Take the locale from a query parameter or a cookie there, the way
[api/payment-return](apps/storefront/src/app/api/payment-return/route.ts) does.

**Cookie `sameSite` on the payment return.** `_medusa_jwt` and `_medusa_cart_id` are set `lax` in
[lib/data/cookies.ts](apps/storefront/src/lib/data/cookies.ts). A redirect-based payment method
brings the customer back through a cross-site top-level navigation, and a `strict` cookie is withheld
on it, which turns the return into a logged-out visitor with no cart. Do not tighten these to
`strict`.

**The seed is all or nothing.** `initial_data_seed` returns early when the sales channel named in
`data/store/json/store.json` already exists, so no stage runs on a database that has been seeded
once. Edits to the JSON data take effect on a fresh database only.

**Only JSON reaches the build.** [scripts/copy-migration-data.js](apps/backend/scripts/copy-migration-data.js)
copies `src/migration-scripts/data` into the build output and filters everything that is not a
directory or a `.json` file. Seed data in any other format is missing at runtime after `medusa build`.

## Starting Point

This project diverged from the Gorgo Medusa DTC Starter and does not track it. The owner keeps an
untouched copy of the starter outside this repository, so a deleted catalog or component can be
recovered from there if it is ever needed. `modules/checkout/components/payment` and
`modules/checkout/components/review` are step-based checkout components that nothing imports. They
are unused and may be deleted when they get in the way.

## Commits

The full rules are in [.cursor/rules/03-git-commits.mdc](.cursor/rules/03-git-commits.mdc) and in
`CLAUDE.md`. In short:

- Use Conventional Commits, `<type>[scope]: <summary>`, lowercase and without a trailing period.
  An optional body explains why.
- A scope names code, such as `storefront` or `vendor-api`, and never a number.
- Sign every commit with SSH, never skip the hooks and never use `--no-verify`.
- Work only on `active-dev`.
- Put no plan, phase, task or requirement number anywhere in git, including branch names, messages,
  pull requests and comments.

| Branch | Role | Who changes it |
|---|---|---|
| `main` | Production | A pull request from `dev`, opened and merged by the owner with a merge commit |
| `dev` | Verified work and the production-build test target | The owner, with a signed `--no-ff` merge from `active-dev` |
| `active-dev` | All AI work and testing | Claude and Cursor, in small signed commits |

Split a formatting pass out of a substantive change, always.

## Writing

These rules cover the English prose in this repository, meaning the READMEs, the docs, the code
comments, the `.env.template` annotations and the storefront's `en.json` strings.

- Active voice and second person. "You set `DATABASE_URL`", not "`DATABASE_URL` is set".
- No em dashes in prose, and no asides set off with a pair of them. Split the sentence instead.
- A colon only before a list broken out onto its own lines, never inside a running sentence.
- Drop "under the hood", "simply", "just", "easy" and "obviously" rather than rephrasing them.
- Headings are statements in Title Case, never questions.
- Never state a version, a path or a behavior you have not traced to the source in this repository.

Keep UI strings short and free of concatenation, because they may be translated later, and give ICU
placeholders names that survive a translator who cannot see the call site.
