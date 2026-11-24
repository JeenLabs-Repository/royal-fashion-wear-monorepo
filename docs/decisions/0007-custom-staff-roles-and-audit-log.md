# 0007 Custom Staff Roles and Audit Log

Status: accepted

Date: 2026-11-24

## Context

Medusa's RBAC and audit modules sit under an enterprise license with an online check. That conflicts with an offline break-glass account.

## Decision

Build staff roles, a deny-by-default permission manifest and an append-only audit table as custom modules. The roles are superadmin, catalog approver, order router, support and finance read-only. A database trigger keeps the audit table append-only. Force core TOTP multi-factor sign-in for staff and vendors. The staff side is built, and the vendor side reuses the same gate factory.

## Consequences

The project owns the access code and its tests. Every admin route needs a manifest entry or a superadmin.

Undo cost: costly, because roles and audit rows become data that other features depend on.

## Alternatives Considered

- Medusa's enterprise RBAC and audit modules. Rejected because of the license and the online check.
- A single shared admin role. Rejected because it gives no separation of duties.

## Final Shape

The build has two custom modules and a request chain.

- The `staffAccess` module stores roles, role assignments with a break-glass flag, and break-glass review rows. The `auditLog` module stores one append-only table.
- A permission manifest with default deny and a route check in CI covers every admin route from our code, `@medusajs/*` and the Gorgo package.
- A gate factory forces TOTP enrolment per actor type, and a challenge disable policy keeps a stolen session from switching MFA off.
- A database trigger rejects UPDATE, DELETE and TRUNCATE on the audit table. A role that owns the table can still drop the trigger, which off-host backups and monitoring cover.
- The break-glass account has an alert, a review and a server command line recovery that was rehearsed on a restored copy.

Consequences of the final shape.

- We own the manifest and the route check, so every new admin route needs a rule in the same change.
- The dashboard cannot hide menus, so pages show a no-access state from the API's 403.
- A later switch to the licensed edition sits behind the same middleware, and the permission strings keep the licensed shape.

Alternatives considered and rejected.

- The licensed RBAC and audit modules, because of the licence and the online check that conflicts with an offline break-glass account.
- Community RBAC plugins, because none gave default deny with a route check.
- One role per user, because a person often needs two non-superadmin roles.
- A role editor, because it adds a surface that can grant everything.
- A REVOKE-based append-only table, because the single database role owns the table.

The owner still has one open question, whether to buy the licensed edition later. Nothing blocks on it.

### Departures From The Original Design

These are the places where the build differs from what was first decided or from stock Medusa practice. Review them here in one place.

1. The break-glass alert window is opened by an atomic Locking module acquire with a 900 second expiry, not by a Redis SET NX with a 900 second expiry. The reason is that it gives the same one-opener-per-window guarantee without a Redis client of our own, works with Redis on or off and adds no package. The limit is that an in-memory Locking provider is atomic only inside one backend process. A multi-instance deployment must register the Redis locking provider that ships inside `@medusajs/medusa`. If the Locking call is unavailable, the fallback order is a cache get then set, then an in-memory store with a logged warning.
2. Request bodies on the staff and review routes are validated in the handler with strict zod objects, not with the `validateAndTransformBody` route middleware that the Medusa guidance prefers. A measured spike showed that a per-route validator entry does run after the admin chain, so the framework path is available. The build kept handler-side validation to match the staff route pattern when those routes landed; switching later remains safe.
3. The one new package of the whole change is the Medusa admin SDK client, `@medusajs/js-sdk`, added at the exact version the storefront already uses.
4. The request audit writer also records core-handled routes that skip the permission steps, such as accepting a staff invite, and it records key names only.
5. Deleting a staff user does not remove their role assignment rows, because there is no cleanup subscriber. Instead every admin request confirms the user still exists and fails closed with 401 `staff_user_not_found`. The reason is one enforcement point, user ids that are never reused, and every reader of assignments confirming that the user exists. The residual window is that a deleted user's access token, which lasts 1 day, or cookie session, which lasts 8 hours, stays cryptographically valid until it expires but authorises nothing on admin routes. The lifetimes are set in code and are not shortened.
