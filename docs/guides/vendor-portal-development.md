# Develop the Vendor Portal

This guide explains how to run, build, test and ship the vendor portal, a static React app that vendors use to sign in, accept the agreement and see their locations. The backend serves the built files at `/vendor-portal/` on its own hostname.

## Run the Portal in Development

Start the backend first, then the portal.

```sh
pnpm backend:dev
pnpm vendor-portal:dev
```

The portal runs at `http://localhost:5173/vendor-portal/`. The dev server proxies three path prefixes to the backend: `/vendor`, `/auth/vendor` and `/auth/mfa`. Every request therefore stays on one origin. The portal keeps the sign-in token in page memory only and sends it in an `Authorization` header: it writes no cookie and no browser storage, so a vendor sign-in never touches a staff session on the same host, and a page reload signs the vendor out. Set `VITE_BACKEND_URL` to change the proxy target from `http://localhost:9000`.

The backend lists the dev origin in `AUTH_CORS`. Add `http://localhost:5173` to that variable in your local `.env` file.

## Build and Test

```sh
pnpm -C apps/vendor-portal run build
pnpm -C apps/vendor-portal run test:unit
pnpm exec playwright test e2e/vendor-portal
```

The build type-checks, writes static files to `apps/vendor-portal/dist` and copies them to `apps/backend/static/vendor-portal`, which git ignores. The unit test covers the path sanitiser. The Playwright specs need the backend running and the demo vendors seeded (see the seed guide).

## Serve the Built Portal From the Backend

After a build, the running backend serves the portal at `http://localhost:9000/vendor-portal/`. Prove it with the check script:

```sh
sh scripts/check-portal-served.sh
```

The script prints one `[PASS]` or `[FAIL]` line per check and ends with `PORTAL_SERVED_CHECKS_COMPLETE` when everything passed. Without a running backend it prints `NOT VERIFIED: backend not reachable` and exits with code 2. Treat that as not verified, never as passed. With `--start-backend` the script creates a throwaway database, builds, migrates and starts the backend itself, runs the checks and stops it (`sh scripts/check-portal-served.sh --start-backend`); that is the one-command form CI uses. To run the browser specs against the served build, set `E2E_PORTAL_URL=http://localhost:9000/vendor-portal`; this is the production-build run that catches policy violations the dev server hides.

The backend image builds the portal in its own stage and sets `VENDOR_PORTAL_DIR` to the copied files. There is no separate portal container, hostname or proxy rule.

## Understand the Header Policy

The portal shares its origin with the admin dashboard, so the backend sets the same strict headers on every portal response: a content security policy (`default-src 'self'`, scripts from the same origin only and never inline, no framing), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex, nofollow`, a permissions policy that turns off camera, microphone and location, and `Cross-Origin-Opener-Policy: same-origin`. The invitation token travels in the address fragment, so the referrer rule and the noindex rule keep it out of logs and search results. The index page is never cached and files under `/assets` are cached for a year because their names change with their content. The handler refuses `..`, encoded and double-encoded traversal and answers 404 for any missing file, so it can never read outside the portal directory.

## Add a Screen

1. Add the route to `src/App.tsx` inside the guarded group. Routes are relative to the `/vendor-portal` base and must not start with `/vendor` or `/auth`.
2. Add the request to `src/lib/api.ts`. Every path must start with `/vendor/`, `/auth/vendor/` or `/auth/mfa/`, or the helper refuses it. Never store the token anywhere; `scripts/check-portal-storage.mjs` fails on any storage or cookie use.
3. Handle loading, empty, error and retry states.
4. Add a Playwright spec under `e2e/vendor-portal` and `data-testid` values for what it touches.
5. Use one design skill for visual work and check the screen at 375, 768 and 1280 pixels.

## Link a Plugin Step

A plugin onboarding step brings a `link`. The portal shows an Open link only when the value is a plain relative path that passes `isSafeRelativePath`: it starts with one slash and has no scheme, host, backslash, whitespace, traversal or encoded dot. Anything else renders no link.

## Add a Package Safely

A new package needs the owner's approval before it is installed. Show its registry data, pin an exact version, commit the lockfile and rerun the pins check.
