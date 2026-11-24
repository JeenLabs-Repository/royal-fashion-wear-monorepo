# Run Browser Tests

This guide explains how to run the Playwright specs and how to record the test data they create.

## Start the Stack

The config does not start servers. Start everything first.

```sh
docker compose -f docker-compose.dev.yml up -d --wait
cd apps/backend
pnpm medusa db:migrate
cd ../..
pnpm backend:seed
pnpm backend:seed:test
pnpm dev
```

Copy the publishable API key that `TEST-CREDENTIALS.local.md` lists into `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` in `apps/storefront/.env.local`, and restart the storefront. Install the browser once with `pnpm e2e:install`.

## Run the Specs

```sh
pnpm e2e
pnpm e2e -- --project=chromium
```

Each run covers a desktop project and a mobile project, so functional and responsive checks happen together. Open `playwright-report/index.html` after a run to see the results. The report folder is ignored by git.

## Write a Spec

- Save every browser flow as a spec in `e2e/specs`. Ad-hoc clicking does not count.
- Name it `<area>-<behavior>.spec.ts` and cover one flow per spec.
- Prefer `data-testid` selectors.
- Add or update a spec with every UI change.

## Record the Data a Test Creates

Call `appendCredentialEntry` from `e2e/support/credentials-log.ts` for every account, form value or order a spec creates. It adds a row to `TEST-CREDENTIALS.local.md` under the section you name, with what the data is, which spec created it and how to reset it. The helper refuses to write unless git ignores the file.

## Test Against a Production Build

Build both apps, run them with production-like settings and point the specs at them with `E2E_STOREFRONT_URL` and `E2E_BACKEND_URL`. Use separate accounts for that run and delete them afterwards.

## Keep Demo Credentials Local

Dev demo credentials are never used in production. The seed script refuses to run when `NODE_ENV` is `production`, and the commit hook blocks the credentials file.
