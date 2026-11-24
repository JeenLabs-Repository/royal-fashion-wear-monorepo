# Storefront

The Next.js 15 storefront of the project. It has a modal checkout, a filterable catalog with instant search, one English UI catalog with the language plumbing kept, and SEO with an `llms.txt` endpoint. It uses React 19, next-intl 4 and Tailwind CSS 3.

The root [README](../../README.md) covers installation and everything that spans both apps.

## Commands

Run these from `apps/storefront` with pnpm.

| Command | Task |
|---|---|
| `pnpm dev` | Start on port 8000 with Turbopack |
| `pnpm build` | Production build (`standalone` output) |
| `pnpm start` | Serve the build on port 8000 |
| `pnpm lint` | Run ESLint |
| `pnpm analyze` | Build with the bundle analyzer enabled |

`lint` and `analyze` load `next.config.js` like a build does, so both need `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` in the environment or in `.env.local`.

## Environment Variables

Copy [`.env.template`](.env.template) to `.env.local`. `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` is the only variable the app refuses to start without, because [`check-env-variables.js`](check-env-variables.js) runs from `next.config.js`. The Default column is the value the template ships.

Every `NEXT_PUBLIC_` value is public. Next.js bakes it into the browser bundle at build time, and the image build passes these values as build arguments. Never put a secret in one.

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | Publishable API key from the Medusa backend. Required | none |
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` | Backend base URL | `http://localhost:9000` |
| `MEDUSA_BACKEND_URL` | Server-only backend address when the server reaches the backend by a different host than the browser. Never a build argument | none |
| `NEXT_PUBLIC_DEFAULT_REGION` | Country code (ISO 3166-1 alpha-2, lowercase) the middleware falls back to when no valid country cookie exists | `in` |
| `NEXT_PUBLIC_BASE_URL` | Storefront base URL, used for absolute URLs in metadata, the sitemap, and `llms.txt` | `http://localhost:8000` |
| `NEXT_PUBLIC_SITE_NAME` | Store name in the header, footer, checkout, `schema.org` markup, and `llms.txt` | none |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics 4 measurement ID, `G-XXXXXXXXXX`. Leave empty to ship no analytics at all | none |
| `NEXT_PUBLIC_STRIPE_KEY` | Stripe publishable key, only needed when paying through Stripe | none |
| `REVALIDATE_SECRET` | Shared secret checked on `api/revalidate`. It must match the backend's value and has no default | none (required) |
| `MEDUSA_CLOUD_S3_HOSTNAME`, `MEDUSA_CLOUD_S3_PATHNAME` | Add the Medusa Cloud bucket to the allowed image hosts | none |
| `NODE_ENV` | Node environment | `development` |

## Analytics

With `NEXT_PUBLIC_GA_MEASUREMENT_ID` set, [`GoogleAnalytics`](src/modules/common/components/google-analytics/index.tsx) holds `gtag.js` back until the browser goes idle after load, or until the visitor first scrolls, taps, clicks or types, capped at 3 seconds, which keeps the script out of Largest Contentful Paint and Total Blocking Time. That has two consequences. A visitor who closes the tab within the first second is never counted, and the tag loads for everyone, so a shop serving the EU or the UK needs a consent banner in front of it. Client-side navigation reports on its own, as long as **Enhanced Measurement** is on for the property.
