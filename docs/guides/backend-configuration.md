# Backend Configuration

How to configure the backend, which variables production requires, and what the start-up check refuses.

## When the Check Runs

- `medusa start` and every other command that boots the backend with `NODE_ENV=production` runs the check first. If anything is wrong the process exits before it opens a port and prints one `Refusing to start in production:` message that lists each offending variable by name and the problem. It never prints a value.
- `medusa build` is exempt, so a container image can be built without any secret present. The secrets arrive at start, from the deployment environment.
- In development and test the check does not block anything. The backend warns once on start, with a line tagged `[config]`, when a secret is a placeholder or too short, and falls back to a development-only signing secret when none is set.

## Variables Production Requires

| Variable | Rule |
|----------|------|
| `JWT_SECRET` | Set, not a placeholder, at least 32 characters. Signs login tokens. |
| `COOKIE_SECRET` | Set, not a placeholder, at least 32 characters. Signs session cookies. |
| `INTEGRATION_ENCRYPTION_KEY` | Set, not a placeholder, at least 32 characters. Encrypts the secrets stored by the Integration Module. |
| `AUTH_MFA_ENCRYPTION_KEY` | Set, not a placeholder, at least 32 characters. Read by the auth module for multi-factor enrolment. |
| `REVALIDATE_SECRET` | Set, not a placeholder, at least 32 characters. Must equal `REVALIDATE_SECRET` in the storefront environment. |
| `REDIS_URL` | Set. Production sessions, events and workflows live in Redis, so they survive a restart. |
| `DATABASE_URL` | Set. |
| `STOREFRONT_URL` | Set, a valid URL for this store. A host on the template vendor's domain is refused. |
| `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` | Set. The Medusa documentation site is refused as an origin. |
| `GORGO_DISABLE_TELEMETRY` | Must be `true`. |
| `COOKIE_SECURE` | Leave unset or set to `true`. Any other value is refused. Production cookies are always secure. |

Also set `MEDUSA_DISABLE_TELEMETRY=true`. The check does not enforce it, but the template and the deployment files do.

## Generating Secrets

Generate each secret on its own, 64 characters long:

```sh
openssl rand -hex 32
```

Use a different value for each variable. Put the values in the deployment environment, never in a file that is committed. `apps/backend/.env.template` only holds `replace-me`.

## Rejected Placeholders

The check refuses these values, compared without regard to letter case, and any value that starts with `dev-only`:

- `supersecret` (the starter's old weak default, named here once so it is recognised)
- `replace-me`, `changeme`, `change-me`
- `secret`, `password`
- an empty value

A value shorter than 32 characters is refused even if it is not on this list.

## Redis

In production `REDIS_URL` switches on three Redis-backed modules: the cache, the event bus and the workflow engine. Without them, sessions, queued events and running workflows sit in memory and are lost on every restart, and a second backend process cannot see the first one's work. In development they stay in memory unless you set `USE_REDIS=true`. The Redis server itself should run with append-only persistence and the `noeviction` policy, which the deployment files set.

## Database TLS

`DATABASE_SSL=true` turns on TLS for the database connection and `DATABASE_SSL_REJECT_UNAUTHORIZED=false` accepts a self-signed certificate. Both are off by default because the database normally sits on a private network. Turn them on if the link crosses a network you do not control.

## The Integration Encryption Key

Every backend process must use the same `INTEGRATION_ENCRYPTION_KEY`. Store a copy offline together with the database backups. If the key is lost, the integration secrets already stored in the database cannot be read again and have to be entered once more.

## Telemetry

`GORGO_DISABLE_TELEMETRY=true` and `MEDUSA_DISABLE_TELEMETRY=true` are set in the template. The first is enforced at start in production.

## Removed Example Routes

The starter shipped two empty example routes, `/store/custom` and `/admin/custom`, that answered 200 to anyone. They are gone and both now answer 404. A test in `apps/backend/integration-tests/http` keeps it that way.
