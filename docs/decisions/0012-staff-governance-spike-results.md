# 0012 Staff Governance Spike Results

Status: accepted

Date: 2026-11-25

## Context

The staff permission design depends on how Medusa 2.22.7 behaves in places the documentation does not cover: where a custom admin middleware runs, what the authentication context holds, how multi-factor sign-in reaches the dashboard, what the backend sees behind a proxy and how the stock command line creates users. Each spike below is a small experiment on a running backend. Each Observed line is a value the run printed. Each Decision line is what the later work builds on.

## Decision

Later work follows the Decision lines in each spike and the final defaults list. A Gate line stops the work when the central assumption fails.

## Consequences

If a Decision line is wrong on a later Medusa version, rerun the spike and supersede this record rather than editing it. Undo cost: reversible, because the record only guides code that is itself covered by tests.

## Alternatives Considered

Building on documentation alone. Rejected because a wrong guess about middleware order or the authentication context either leaves routes open or locks the owner out.

## S1 Admin Middleware Visibility

Question: Does a custom middleware on the admin path prefix see the authentication context on core routes and on the integrations routes, and can it reject both?
Setup: Probe middleware with variants A to E on a throwaway branch, bearer token for a user created with the stock command line, Medusa 2.22.7.
Run on: 2026-11-25 against Medusa 2.22.7
Observed: Variant A on the core products route: authentication context is defined, actor type user.
Observed: Variant A on the integrations route: authentication context is defined, actor type user.
Observed: Variants B and C on the core products route: actor type user, actor id present true, context keys actor_id,actor_type,app_metadata,auth_identity_id,auth_provider,exp,iat,mfa_challenge_completed_at,mfa_enabled,user_metadata.
Observed: Variants B and C on the integrations route: actor type user, actor id present true.
Observed: The 418 probe stopped the core products route: yes; stopped the integrations route: yes.
Observed: The property holding the full path is originalUrl; path holds a slash alone under the prefix matcher; baseUrl holds the matched route path such as /admin/products.
Observed: Trailing slash reached the probe and the route: yes (probe yes, route status 404 for bare admin); mixed case reached the probe and the route: yes with the string matcher (status 200), no with the RegExp matcher (status 200 from core without the probe); the path /adminx reached the probe: yes with the string matcher and no with the RegExp matcher.
Observed: The bare admin path and the admin path with a trailing slash match the string matcher: yes; the RegExp matcher: yes.
Observed: Order inside one route entry holding two array items: first item runs first; order across three separate route entries that match the products route: E-chain-1, then E-chain-2-array-a, then E-chain-2-array-b, then E-per-route (seq 1 to 4).
Observed: A per-route entry added after the admin chain runs after it: yes.
Observed: A module resolves from the request scope after the response ended: yes; the authentication context is still readable at finish: yes.
Observed: Without a token the products route answers 401 from core authentication (the probe does not run).
Observed: The invite-accept route with a token of an identity that has no user answers 401 from our own authenticate call (message Unauthorized); the probe never runs, so the authentication context at finish is not reachable on that path while the chain includes authenticate without allowUnregistered.
Decision: Use the matcher string `/admin*` for the admin chain (case-insensitive; also matches `/adminx`, so the path normaliser must accept only `/admin` and `/admin/...`). Prefer that form over the RegExp `^/admin(/.*)?$`, which misses mixed-case paths unless an `i` flag is added.
Decision: Our own authenticate call is required first because the invite-accept path needs an explicit allowUnregistered option, the api-key refusal needs a controlled auth type list, and later MFA options hang off the same call. Variant A already sees a context that core filled, but that is not enough control for the chain.
Decision: The path normaliser reads `originalUrl`.
Decision: Per-route validator entries do run after the admin chain, so the staff routes may use the framework body validator.
Decision: The chain bypasses the invite-accept route by excluding `POST /admin/invites/accept` from the admin matcher (or by registering that path with authenticate that sets allowUnregistered true and skips role and MFA gates). The audit writer cannot read the context at finish on that route while the default chain authenticate rejects first; use the excluded-route form so core can answer and a finish hook on that excluded entry can still record when needed.
Gate: PASS

## S2 Secret API Key Actor

Question: What actor type does a secret API key produce, and which header format authenticates it?
Setup: Key created through the api-keys admin route, probe variant B, then variant S2.
Run on: 2026-11-25 against Medusa 2.22.7
Observed: The Basic header with the key as user name and an empty password returned 200.
Observed: The `x-medusa-access-token` header returned 401.
Observed: The logged actor type for the key is `api-key`; actor id equals the key id: yes (framework sets actor_id to apiKey.id in authenticate-middleware).
Observed: After rejecting on that actor type the products route answered 403; the key was revoked with status 200 and then deleted with status 200.
Decision: Compare the actor type against the literal `api-key`; the supported header format is HTTP Basic with the secret key as the user name and an empty password.

## S3 Multi-Factor Enrolment Path

Question: How does the dashboard behave for an unenrolled admin, which requests does the Security screen make, where is the enrolment flag read from and how does a test obtain a token for an enrolled identity?
Setup: Auth module declared with the multi-factor options and a 64-character key, probe variants B and S3, dashboard at the backend app path.
Run on: 2026-11-25 against Medusa 2.22.7
Observed: The accepted option names under `mfa` are `encryption_key`, `recovery_code_count`, `challenge_ttl_seconds`, `challenge_max_attempts`, `disable_policy`, and `providers`; the names from the plan (`encryption_key`, `disable_policy`) boot cleanly.
Observed: For an unenrolled admin the authentication context has `mfa_enabled` present with value false. The flag is written into the JWT by `apps/backend` auth helper `generate-jwt-token` (Medusa package path `api/auth/utils/generate-jwt-token.js`), which sets `mfa_enabled` from an explicit argument or by calling `listAuthMfa({ auth_identity_id, status: "enabled" })` on the Auth module. The authenticate middleware then exposes that claim on `auth_context.mfa_enabled`.
Observed: The login response for an enrolled identity is HTTP 200 with keys `mfa_required`, `mfa_challenge` (id, auth_identity_id, auth_provider, methods, expires_at, attempts, max_attempts, completed_at, metadata), and a partial `token` whose payload already has `mfa_enabled` true and `mfa_challenge_completed_at` null. After `POST /auth/mfa/challenges/:id/verify` with body keys `method` and `code`, the response is `{ token }` with `mfa_challenge_completed_at` set.
Observed: Requests the dashboard makes during login and challenge: `POST /auth/user/emailpass`, `POST /auth/mfa/challenges/:id/verify`, `POST /auth/session` (session exchange after a full token).
Observed: The enrolment call `POST /auth/mfa/factors` returns keys `mfa_factor`, `secret`, `otpauth_url`; it includes both the TOTP secret and an otpauth URI, so an end-to-end test can compute a code with node crypto.
Observed: With the 403 gate active (allowing only `/auth*` and `GET /admin/users/me`), the Profile and Security screen made these admin requests: `GET /admin/users/me` (allowed), `GET /admin/layouts/settings.sidebar/configuration` (blocked), `GET /admin/modules` (blocked), `GET /admin/search-indexes` (blocked), `GET /admin/layouts/configurations` (blocked), `GET /admin/notifications` (blocked), `GET /admin/cloud/announcements` (blocked), `GET /admin/layouts/topbar/configuration` (blocked), `GET /admin/layouts/profile.details/configuration` (blocked). MFA calls on `/auth/mfa/factors`, `POST /auth/mfa/factors`, `POST /auth/mfa/factors/:id/verify`, and `POST /auth/mfa/recovery-codes` are outside the admin matcher so the gate never sees them. With only the minimal allowlist the Profile page failed to render. After adding the blocked shell routes to the allowlist, the Two-factor authentication section rendered, `POST /auth/mfa/factors` returned a pending factor with secret and otpauth URI, and enrolment completed (verify 200, recovery codes 200, factor status enabled). `GET /admin/products` stayed 403 while unenrolled.
Observed: With the challenge disable policy a session alone cannot remove the factor; `DELETE /auth/mfa/factors/:id` with an empty body or `{ method: "session" }` returns 400 `MFA verification code is required to disable MFA`.
Observed: Auth module methods that list and delete factors: `listAuthMfa(filters?: FilterableAuthMfaProps)` with filters `id`, `auth_identity_id`, `provider`, `status`; `retrieveAuthMfa(selector)`; `disableAuthMfa({ id, method?, code? })`. There is no separate public delete-by-filter; disable is the removal path. Related: `startAuthMfa`, `verifyAuthMfa`, `createAuthMfaChallenge`, `verifyAuthMfaChallenge`, `generateAuthMfaRecoveryCodes`.
Observed: The token recipe that worked for an enrolled identity: mint a bearer token with `generateJwtToken` from `@medusajs/framework/utils` using payload keys `actor_id`, `actor_type`, `app_metadata`, `auth_identity_id`, `auth_provider`, `mfa_enabled` (true), `mfa_challenge_completed_at` (ISO string), `user_metadata`, and the project JWT secret; `GET /admin/users/me` returned 200. Completing a challenge with a node-crypto TOTP from the enrolment secret also works and is the path a real login uses.
Decision: The allowlist is `GET/POST/DELETE` under `/auth/*` (including `/auth/mfa/factors`, `/auth/mfa/factors/:id`, `/auth/mfa/factors/:id/verify`, `/auth/mfa/recovery-codes`, `/auth/mfa/challenges/:id/verify`, `/auth/user/emailpass`, `/auth/session`), plus `GET /admin/users/me`, `GET /admin/staff/me`, `GET /admin/layouts/*`, `GET /admin/modules`, `GET /admin/search-indexes`, `GET /admin/notifications*`, and `GET /admin/cloud/announcements*`.
Decision: The enrolment flag is read from `auth_context.mfa_enabled` on the JWT; the fallback if it is absent is `listAuthMfa({ auth_identity_id, status: "enabled" })` on the Auth module (the same call the token helper uses).
Decision: Tests obtain a token with `generateJwtToken` and payload keys `actor_id`, `actor_type`, `auth_identity_id`, `auth_provider`, `app_metadata`, `user_metadata`, `mfa_enabled`, `mfa_challenge_completed_at`.

## S4 Client Address Behind a Proxy

Question: What do `req.ip` and the forwarded header hold, and how is the trusted hop count applied?
Setup: Address probe variant S4 with and without a trust proxy setting.
Run on: 2026-11-25 against Medusa 2.22.7
Observed: The framework sets trust proxy in `express-loader.js` with `app.set("trust proxy", 1)` on every boot; `projectConfig.http` does not expose an option for it.
Observed: As shipped, `req.ip` is `203.0.113.9`, `req.ips` is `["203.0.113.9"]`, the raw header is `203.0.113.9`, trust proxy reads `1`.
Observed: With trust proxy forced to 0 in the earliest middleware, `req.ip` is `::1`, `req.ips` is `[]`, the raw header remains `203.0.113.9`, trust proxy reads `0`.
Observed: With trust proxy 1, `req.ip` is `203.0.113.9` for a one-entry header and `198.51.100.7` for the two-entry header `203.0.113.9, 198.51.100.7` (Express skips one hop from the right, so the right-most forwarded entry becomes `req.ip`).
Decision: The trusted hop count is applied by calling `req.app.set("trust proxy", hops)` in the earliest admin middleware (or an equivalent boot hook), driven by a bootstrap variable named `TRUST_PROXY_HOPS` with default 0 in development and 1 behind the reverse proxy. The framework default of 1 must be overridden when the bootstrap value is 0.
Decision: The audit field for the forwarded header stores the raw first header entry, and the `ip` field stores `req.ip`.

## S5 Stock Command Line User Creation

Question: What does the stock user command create, and what does it do for an existing email?
Setup: Backend source and a throwaway database, command run twice with the same email.
Run on: 2026-11-25 against Medusa 2.22.7
Observed: The command accepts the flags `--email` (`-e`), `--password` (`-p`), `--id` (`-i`), `--invite`, plus shared CLI flags `--verbose`, `--no-color`, `--json`, `--help`, `--version`.
Observed: A new run created one user row, one auth identity, and one provider identity; the identity stores the user id under the metadata key `user_id` inside `app_metadata`.
Observed: The second run with the same email and another password errored with Medusa `invalid_data` from `UserModuleService.createUsers` / `create-users-workflow` (duplicate email); the user count stayed 1; the password was not updated.
Observed: The command creates the user through `workflowEngine.run("create-users-workflow", { input: { users: [{ email, roles }] } })`, then `authService.register("emailpass", { body: { email, password } })`, then `authService.updateAuthIdentities({ id, app_metadata: { user_id } })`. When Medusa RBAC is installed it also assigns the super-admin role id; this project has no staff assignment table yet, so a CLI user has no staff assignment.
Observed: Calls that create a password identity, link it to a user and reset the password of an existing identity: create via `authService.register("emailpass", { body: { email, password } })`; link via `authService.updateAuthIdentities({ id, app_metadata: { user_id } })`; reset via `authService.updateProvider("emailpass", { email, password, entity_id })` (Auth module API; the stock CLI does not reset on duplicate).
Decision: The recovery scripts create users with `create-users-workflow` (or `UserModuleService.createUsers`), create password identities with `authService.register("emailpass", ...)`, link with `authService.updateAuthIdentities` setting `app_metadata.user_id`, and reset passwords with `authService.updateProvider("emailpass", { email, password, entity_id })`.
Decision: A user created by the stock command has no staff assignment, so default deny blocks it until a script or a superadmin assigns a role.

## S6 Module Loader and Test Harness

Question: When does a module loader run, do hand-written migrations run in the test runners, and how does a test run raw SQL as the application role?
Setup: Throwaway module with one model, a loader, a generated-style migration and a hand-written trigger migration, one module runner test and one http runner test.
Run on: 2026-11-25 against Medusa 2.22.7
Observed: The loader runs on backend start (`[spike] loader ran` before Server is ready) and can read the table afterward.
Observed: The loader also runs during `medusa db:migrate`, after the module migrations complete (table read returned row count 0); it did not run before the table existed in this run.
Observed: A thrown error in the loader stops boot (`Loaders for module SpikeMod failed: spike loader failure`; server never becomes ready).
Observed: The http runner shows the trigger created by the hand-written migration (`spike_item_no_update` present).
Observed: The connection object is a knex instance (`dbConnection.raw` works; a later knex connection error confirmed the driver); `select current_user` returns role `postgres` under the test `DB_*` credentials.
Observed: The module runner does not show the trigger (empty trigger list); it builds its schema from the models, not from the hand-written migrations.
Decision: Role synchronisation that must not break boot runs as a migration script or a dedicated `medusa exec` script; a loader may run soft sync with try/catch because a thrown loader stops the process. Prefer a migration script when the work must happen exactly once with the schema.
Decision: Trigger tests live in `integration-tests/http/*.spec.ts` under `medusaIntegrationTestRunner`; raw SQL as the application role runs with `dbConnection.raw(sql)` (knex). Module-runner tests alone cannot assert hand-written triggers.

## S7 Alert Window Primitive

Question: Which call opens an alert window once per 15 minutes atomically, with Redis on and off?
Setup: A script run with `medusa exec`, once with Redis enabled and once without.
Run on: 2026-11-25 against Medusa 2.22.7
Observed: The registered locking provider is `in-memory` without Redis and still `in-memory` with `USE_REDIS=true` until `@medusajs/medusa/locking-redis` is registered explicitly (Redis was connected for cache, event-bus and workflow-engine only).
Observed: A second owner acquiring a held key throws at once with message `Failed to acquire lock for key "spike:window"` (does not wait).
Observed: The same owner acquiring again succeeds.
Observed: After the expiry another owner succeeds; the expire unit is seconds (`expire: 2`, wait 3 seconds, then acquire ok).
Observed: Two simultaneous acquires gave exactly one success (`fulfilled,rejected`).
Observed: The cache set with a ttl of 2 returned `{"a":1}` immediately and `null` after 3 seconds; the ttl unit is seconds; with Redis on (cache-redis) and off the acquire behaviour matched for the in-memory locking provider; cache get/set still worked in both runs.
Decision: The window opens with the locking module `acquire` call using a key such as `["break-glass:alert-window", actorId]`, a fresh owner id per attempt, and an expiry of 900 seconds, never released.
Decision: The fallback order is the cache get then set, then an in-memory store with a logged warning.
Decision: An in-memory locking provider is atomic only inside one backend process; if more than one backend instance ever runs, register the Redis locking provider that ships inside `@medusajs/medusa` as `{ resolve: "@medusajs/medusa/locking-redis", options: { redisUrl } }` (no new package).
Decision: This replaces the earlier wording of a raw Redis set-if-absent with a 900 second expiry, because the locking module gives the same atomic acquire-with-expiry without a new dependency; the unique open-review index and the notification idempotency key stay as a second line of defence.

## S8 Integration Updated Event

Question: What does the integration update event carry, and where is the change history kept?
Setup: A probe subscriber logging the event name and sorted data key names only; upsert workflow source inspected; a workflow-shaped emit confirmed the subscriber.
Run on: 2026-11-25 against Medusa 2.22.7
Observed: The event name is `integration.updated` and the data keys from the Gorgo upsert workflow emit are `actor`, `change`, `fields`, `provider_id` (confirmed by subscriber log `data_keys=actor,change,fields,provider_id`).
Observed: An integration row id is not present; the stable key is `provider_id`. A change id is not present on the event.
Observed: The change-history model is `IntegrationChange`, its table is `integration_change`, and the module writes rows with `createIntegrationChanges` / `recordChange`; the admin list route reads via Query graph on entity `integration_change` (newest first). Generated list helpers follow the MedusaService naming `listIntegrationChanges`.
Decision: The audit subscriber writes the provider id from the event and the newest change id looked up afterward; when the event lacks the change id it reads the newest change id through `listIntegrationChanges({ provider_id }, { order: { created_at: "DESC" }, take: 1, select: ["id"] })` (or the equivalent Query graph on `integration_change`).

## Defaults for later plans

S1: Matcher string `/admin*`, own authenticate first, path from `originalUrl`, per-route validators run after the chain, exclude invite-accept from the chain, Gate PASS
S2: Actor type literal `api-key`; header HTTP Basic with the secret key as user name and empty password
S3: Allowlist `/auth/*` plus `GET /admin/users/me`, `GET /admin/staff/me`, layout/shell GETs (`/admin/layouts/*`, `/admin/modules`, `/admin/search-indexes`, `/admin/notifications*`, `/admin/cloud/announcements*`); flag from `auth_context.mfa_enabled` with `listAuthMfa` fallback; tests mint JWT via `generateJwtToken`
S4: Apply `TRUST_PROXY_HOPS` with `req.app.set("trust proxy", hops)` in earliest middleware (framework hardcodes 1; no projectConfig option); store raw first forwarded entry and `req.ip`
S5: Create with `create-users-workflow`, identity with `auth.register("emailpass")`, link with `updateAuthIdentities` `user_id`, reset with `updateProvider("emailpass")`; CLI user has no staff assignment
S6: Role sync in migration script or `medusa exec` (loader throw stops boot); trigger tests in http runner; raw SQL via `dbConnection.raw`
S7: Window via Locking `acquire` expire 900 seconds fresh owner id never released; fallback cache then in-memory; register `@medusajs/medusa/locking-redis` for multi-instance
S8: Event keys `provider_id`, `change`, `actor`, `fields`; look up newest `integration_change` id by `provider_id` when change id is absent
