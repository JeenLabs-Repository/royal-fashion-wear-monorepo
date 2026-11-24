# Backend

The Medusa application of the project. It provides the Store and Admin APIs, the Admin dashboard, transactional emails, seed data for the India region in English, and the Integration Module for configuring providers without a redeploy. It runs Medusa 2.22.7 on Node 22.23.4 or newer.

The root [README](../../README.md) covers installation and everything that spans both apps.

## Commands

Run these from `apps/backend` with pnpm.

| Command | Task |
|---|---|
| `pnpm dev` | Start in development mode with the Admin and hot reload |
| `pnpm build` | Build the application, then copy the seed JSON into the build output |
| `pnpm start` | Start from the build |
| `pnpm medusa db:migrate` | Run migrations and sync links |
| `pnpm seed` | Seed the store with the India region, English and the demo catalog |
| `pnpm seed:test-data` | Create fake test accounts and write `TEST-CREDENTIALS.local.md` |
| `pnpm lint` | Lint with `@medusajs/eslint-plugin` |
| `pnpm test:unit` | Unit tests |
| `pnpm test:integration:http` | HTTP integration tests |
| `pnpm test:integration:modules` | Module integration tests |

`medusa develop` runs `medusa lint` before it starts and refuses to boot on a lint error, while `medusa build` reports problems and builds anyway. Pass `--lint false` to either one to skip it.

## Environment Variables

Copy [`.env.template`](.env.template) to `.env`. In development you need few values, because the template points at the development stack from `docker-compose.dev.yml`. In production the boot check requires the variables listed in [docs/guides/backend-configuration.md](../../docs/guides/backend-configuration.md) and refuses to start without them.

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgres://postgres:postgres@localhost:5432/$DB_NAME` |
| `DB_NAME` | Database name interpolated into `DATABASE_URL` | `medusa_dtc_starter` |
| `DATABASE_SSL` | Set to `true` to use TLS on the database connection | unset |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Set to `false` to accept a self-signed database certificate | unset |
| `STORE_CORS` | Allowed origins for the Store API | `http://localhost:8000` |
| `ADMIN_CORS` | Allowed origins for the Admin API | `http://localhost:5173,http://localhost:9000` |
| `AUTH_CORS` | Allowed origins for authentication | `http://localhost:5173,http://localhost:9000` |
| `JWT_SECRET` | Signing secret for JWTs | none (required in production) |
| `COOKIE_SECRET` | Signing secret for cookies | none (required in production) |
| `COOKIE_SECURE` | Production requires `true` or unset. Cookies are always secure in production | unset |
| `AUTH_MFA_ENCRYPTION_KEY` | Encrypts the second factor secrets of the auth module | none (required in production) |
| `REDIS_URL` | Redis instance for the cache, event bus, workflow engine and sessions | `redis://localhost:6379` |
| `USE_REDIS` | Set it to `true` to use `REDIS_URL` in development too | unset |
| `CACHE_REDIS_URL` | Separate Redis instance for the cache | `REDIS_URL` |
| `INTEGRATION_ENCRYPTION_KEY` | Encrypts the secret fields the Integration Module stores. Use the same value on every backend process | none (required in production) |
| `GORGO_DISABLE_TELEMETRY` | Turns the Gorgo module telemetry off. Production requires `true` | `true` |
| `VENDOR_PORTAL_URL` | Vendor portal base URL (with the `/vendor-portal` path) used in invitation links. Production requires an https URL | `http://localhost:5173/vendor-portal` |
| `MEDUSA_DISABLE_TELEMETRY` | Turns the Medusa telemetry off | `true` |
| `RUN_MIGRATIONS` | Read by the image entrypoint. Set it to `false` to skip migrations at container start | `true` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | SMTP transport for transactional emails. Development points at Mailpit | `localhost`, `1025`, `false` |
| `SMTP_USER`, `SMTP_PASS` | SMTP credentials | none |
| `SMTP_FROM`, `SMTP_REPLY_TO` | Sender and reply-to addresses. `SMTP_FROM` carries the address and the name beside it comes from `STORE_NAME` | `store@example.test`, none |
| `STOREFRONT_URL` | Storefront base URL used in email links and revalidation webhooks | `http://localhost:8000` |
| `REVALIDATE_SECRET` | Sent as `x-revalidate-secret` to the storefront and must match its value | none (required in production) |
| `STOREFRONT_DEFAULT_LOCALE` | Fallback email language when the buyer's is unknown, one of the locales under `src/emails/i18n` | `en` |
| `STORE_NAME`, `STORE_EMAIL`, `STORE_PHONE`, `STORE_ADDRESS` | Store branding in email templates. `STORE_NAME` is also the sender name emails arrive under | none |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` | S3-compatible file storage, used when `NODE_ENV=production` | none |
| `MEDUSA_ADMIN_ONBOARDING_NEXTJS_DIRECTORY` | Storefront directory for Medusa's onboarding flow | `medusa-storefront` |
