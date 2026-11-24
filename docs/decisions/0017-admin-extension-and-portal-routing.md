# 0017 Admin Extension and Portal Routing

Status: accepted

Date: 2026-11-25

## Context

The vendor detail page in the dashboard needs a place for plugin sections, and a static portal behind Traefik path rules was spiked for the original separate-host layout. An owner decision later places the portal on the backend at `/vendor-portal/`; this record still states what was observed for widget zones and for the Traefik path-rule shape.

## Observed

### E12 Widget Zone for a Custom Page

Request: a scratch custom page and a widget aimed at the zone `vendor.details.after`, then a production build.
Observed: the build succeeded (unknown zone is a Vite plugin warning / lint error, not a failed build); the page marker was found in `apps/backend/.medusa/server/public/admin/assets/index-82P8DIIv.js`; the zone name `vendor.details.after` was found in the dashboard package 0 times; product zones that exist for comparison (from `@medusajs/admin-shared`): `product.details`, `product.details.side`, and legacy `product.details.before`, `product.details.after`, `product.details.side.before`, `product.details.side.after`.
Decision for the plans: plugin sections for a vendor are links rendered by the vendor detail page; a custom page cannot host widget zones.

### E13 Static Portal Behind Traefik

Request: the compose file in `deploy/dev/portal-routing` with host header `vendors.localhost`.
Observed: `/` returned 200 with the marker `PORTAL-SPA-MARKER`; `/login` returned 200 and `/admin/anything` returned 200 (fallback page); `/vendor/me`, `/auth/vendor/emailpass` and `/auth/mfa/x` were answered by the whoami backend service (`Hostname:` lines and `X-Forwarded-For`); the root carried `Content-Security-Policy`, `Referrer-Policy`, `X-Robots-Tag`; a missing asset returned 404 with the cache header present (`Cache-Control: public, max-age=31536000, immutable`).
Observed: image digests: traefik `traefik@sha256:00c9734983e74ae35a1fc18eaee9e9da13f3dde95c4e45b3b8c3b60e0dbd2d17` (tag `v3.8`; draft `v3.1` failed on this host with Docker API client too old), nginx unprivileged `nginxinc/nginx-unprivileged@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0`, whoami `traefik/whoami@sha256:43a68d10b9dfcfc3ffbfe4dd42100dc9aeaf29b3a5636c856337a5940f1b4f1c`.
Decision for the plans: a priority 100 rule for the three backend prefixes and a priority 1 catch-all for the portal works yes; the portal image is pinned by digest in the real build; an explicit 404 rule for any other backend prefix on the portal host is added with the proxy rules. Production hosting serves the portal from the backend at `/vendor-portal/`; this compose file remains a local path-rule check.

## Decision

Sections are links. The path-rule shape (priority 100 for `/vendor`, `/auth/vendor`, `/auth/mfa`; priority 1 catch-all for static) works on Traefik v3.8. Launch serving uses the backend static route at `/vendor-portal/`, not a separate vendors hostname.

## Consequences

The vendor detail page owns the list of plugin links. The local compose file documents the Traefik label shape if a separate host is ever revived; production proxy work follows the backend-served portal decision unless the owner reopens it.

Undo cost: costly, because the hostname and routing layout end up in cookies, headers, images and proxy rules when a separate host is used.

## Alternatives Considered

- A Node server for the portal: rejected because it adds a process for static files.
- A separate hostname for the vendor API: rejected for launch in favour of a shared origin with Bearer-only tokens.
- Keeping Traefik v3.1 from the draft: rejected on this host because Docker 29 refuses its Docker API client.
