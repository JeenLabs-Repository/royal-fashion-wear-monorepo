# Know the Required Checks

This guide lists the checks that must pass before a change reaches `dev` or `main`, what each one proves and the command that runs it on your machine. The single required status check is `ci-gate`, which waits for every job below.

## The Jobs Behind the Gate

| Check | What it proves | Run it locally |
|---|---|---|
| `lint` | The backend and the storefront pass their linters. | `pnpm -C apps/backend run lint` and `pnpm -C apps/storefront run lint` |
| `typecheck` | Both apps compile without type errors. | `pnpm -C apps/backend exec tsc --noEmit` and `pnpm -C apps/storefront exec tsc --noEmit` |
| `build-backend` | The backend builds, including the admin bundle. | `pnpm -C apps/backend run build` |
| `build-storefront` | The storefront builds. | `pnpm -C apps/storefront run build` |
| `backend-tests` | The admin route check, the unit tests, the module tests and the HTTP tests pass. The HTTP tests include the cross-vendor matrix, the store guard, the vendor lifecycle and the permission tests. | `pnpm -C apps/backend run check:admin-routes`, then the three `test:` scripts in `apps/backend` |
| `guards` | The repository rules hold: exact version pins, workflow pins, no plan references in tracked files, no vendor tax or bank columns in the vendor schema, and the other guards. | `pnpm run guards` |
| `gitleaks` | No secret is in the history. | `gitleaks git --redact --config .gitleaks.toml` |
| `signatures` | Every commit is signed. | `sh scripts/verify-signatures.sh main..HEAD` |
| `branch-name` | The branch name follows the naming rule. | `node scripts/check-branch-name.mjs` |
| `vendor-portal` | The portal type-checks, its unit tests pass, it builds, and a backend started on a throwaway database serves it at `/vendor-portal/` with the strict policy headers, refuses traversal and encoded traversal, and keeps `/admin` and `/vendor` as API routes. | `pnpm -C apps/vendor-portal run typecheck`, `pnpm -C apps/vendor-portal run test:unit`, `pnpm -C apps/vendor-portal run build`, then `sh scripts/check-portal-served.sh --start-backend` |
| `canary` | No vendor string appears in any customer-facing surface of a built backend and storefront. | `sh scripts/run-canary.sh` |

On pull requests to `main`, the `pr-notes` check also requires the pull request notes to follow the template.

## Read a Failure

- A `backend-tests` failure named `vendor-matrix` points at the route and the assertion. A message that starts with `Missing matrix fixture` means a new route has no fixture. See [Add a Vendor Route](add-a-vendor-route.md).
- A `canary` failure prints the surface address, the matched string, the form it took and a short excerpt. Fix the code that wrote vendor data to a customer-facing output. See [Add a Canary Surface](add-a-canary-surface.md).
- A `guards` failure names the guard script. Each script prints what it checked and what to change.

## Run Everything Before You Promote

```sh
pnpm run guards
pnpm -C apps/backend run test:unit
pnpm -C apps/backend run test:integration:modules
pnpm -C apps/backend run test:integration:http
pnpm -C apps/vendor-portal run test:unit
pnpm -C apps/backend run build
pnpm -C apps/vendor-portal run build
sh scripts/check-portal-served.sh --start-backend
sh scripts/run-canary.sh
pnpm exec playwright test e2e/admin e2e/vendor-portal
```

The integration tests need the dev database from the getting-started guide. The served-portal script and the canary script need `psql` and a reachable Postgres server. Record any command that could not run as not verified.
