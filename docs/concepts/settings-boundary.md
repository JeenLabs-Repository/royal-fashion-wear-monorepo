# Settings Boundary

Most settings live in Settings, Integrations so the owner can change them without a deploy. A small set of values must exist before the database does, or guards the secrets of every other setting, or registers code. Those stay in the environment or in `medusa-config.ts`. This page lists both groups and explains how a change takes effect.

## What Stays in the Environment

| Value | Why it stays |
|-------|--------------|
| `DATABASE_URL` | The backend needs it to open the database that holds every card. |
| `INTEGRATION_ENCRYPTION_KEY` | It decrypts every stored secret, so a card cannot hold it. |
| `JWT_SECRET` and `COOKIE_SECRET` | They sign sessions and tokens before any card can be read. |
| `AUTH_MFA_ENCRYPTION_KEY` | It protects authenticator secrets and is a bootstrap secret. |
| `REDIS_URL` | The cache, event bus and workflow engine start before cards load. |
| `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` | The HTTP layer reads them at boot. |
| Provider registration in `medusa-config.ts` | Registration decides which code loads, so it is code. |
| S3 credentials (`S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`) | File storage starts at boot. |
| `REVALIDATE_SECRET` | The storefront and backend share it before any card exists. |
| `STOREFRONT_URL`, `ADMIN_APP_URL`, `VENDOR_PORTAL_URL` | Links in emails and redirects need them at boot. |
| `BREAK_GLASS_ALERT_EMAILS` | The alert must work when the database is the problem. |
| `TRUST_PROXY_HOPS` | The HTTP layer reads it at boot. |

Monitoring uses a self-hosted Uptime Kuma instance, so no error-tracking address belongs in the environment.

## What Lives in Settings Cards

These cards exist now.

- Razorpay keys and the webhook secret
- GST and legal identity of the seller
- SMTP mail delivery
- Vendor onboarding (invite expiry and the current agreement version)

Documents, customer identity and routing preferences arrive as later cards in the same settings plugin. A card holds a value when the owner may change it while the store runs and the application can read it at call time.

## How a Change Takes Effect

Readers call the Integration Module at call time. The module caches resolved options for 60 seconds per process and clears the cache when you save in the process that handled the save. Other processes can lag by up to one minute. Run one backend process at launch so a save applies at once.

## The Encryption Key

`INTEGRATION_ENCRYPTION_KEY` must be identical on every backend process, including any worker you add later. A process with a different key cannot read the stored secrets. Never use a placeholder value such as `supersecret`. If you lose the key, every stored secret becomes unreadable, so keep a list of every credential and where to reissue it, and store the key apart from database backups.

## Rotation

1. Save the new value in the card.
2. Wait two minutes so every process drops its cached copy.
3. Run the connection test on the card.
4. Revoke the old credential at the provider.

For the webhook secret the payment gateway retries failed deliveries, so a short overlap between the old and new secret is acceptable.

## Development Fallback

The mail card has a development fallback. Outside production, the backend may read `SMTP_*` variables for a local mail catcher when no card is saved. It logs this at boot. In production the card is the only source, so the screen never shows one value while the runtime uses another. One file reads these variables, and a test fails if any other provider or settings file reads the environment.

## The Adoption Rule

A third-party plugin without a wrapper descriptor is not adopted. A wrapper descriptor is a card in the settings plugin that exposes the plugin's settings, listed in `config/plugin-descriptors.json`. Two unit tests enforce the rule.

- `integration-descriptors.unit.spec.ts` fails when a plugin or provider in `medusa-config.ts` has no mapped, registered and resolvable wrapper descriptor and no entry in `config/descriptor-exempt.json`. That file holds only the Integration Module itself.
- `no-env-settings.unit.spec.ts` fails when application provider code or an installed first-party plugin build reads the environment for a setting that has a card. The runtime mode and the development mail fallback are the only allowed reads.

See [Adopt a Plugin](../guides/adopt-a-plugin.md) for the steps.
