# 0014 Vendor Actor and Two-Step Sign-In Mechanics

Status: accepted

Date: 2026-11-25

## Context

Vendors sign in through their own actor type on a separate surface. This record states what Medusa 2.22.7 does for that actor type, so the invite, session and two-step sign-in code follows observed behaviour. Secrets, tokens and recovery codes are written as `<redacted>`.

## Observed

### E1 Vendor Actor Login

Request: `POST /auth/vendor/emailpass`, then `GET /vendor/ping` with the bearer token, then `GET /admin/users/me` with the same token.
Observed: login 200 with body keys `token`; the vendor route returned 200 with actor type `vendor` and actor id `spike_user_1`; the admin route returned 401; a call with no header returned 401.
Observed: the register call shape that worked is `auth.register("emailpass", { url, headers, query, protocol, body: { email, password } })` (body-only also works); the link key that produced the actor id is `vendor_id` in `app_metadata`.
Decision for the plans: register with `auth.register("emailpass", …)`, then `updateAuthIdentities({ id, app_metadata: { vendor_id } })`; `authenticate("vendor", ["session","bearer"])` exposes that id as `actor_id`.

### E2 Open Registration

Request: `POST /auth/vendor/emailpass/register` with a new email, then with each scratch matcher.
Observed: without a block the stock route answered 200 with body keys `token`; a string matcher blocks; a RegExp matcher blocks; login still answered 200 with `token`.
Observed: identities can be listed by email with `auth.listProviderIdentities({ entity_id: email })` and with `query.graph({ entity: "auth_identity", fields: ["id"], filters: { provider_identities: { entity_id: email } } })`; both returned the identity from E1.
Decision for the plans: the registration block uses either a string matcher `"/auth/vendor/emailpass/register"` or RegExp `/^\/auth\/vendor\/emailpass\/register\/?$/` (both work); the existing-identity check uses `listProviderIdentities({ entity_id })`.

### E3 Actor Association Option

Request: `grep` for `requireActorAssociation` in the installed packages, then login of an unassociated identity with the option unset and set.
Observed: defined in `@medusajs/medusa` as `projectConfig.http.requireActorAssociation[authProvider]` (boolean per provider); unset by default. Unset: login of an identity with no `vendor_id` returned 200 with empty `actor_id`; `GET /vendor/ping` with that token returned 401. With `requireActorAssociation: { emailpass: true }`: unassociated login returned 401 `Authentication failed`; linked login still returned 200 with the MFA challenge shape.
Decision for the plans: set `http.requireActorAssociation.emailpass` to `true` in addition to the registration block, token-gated identity creation and a regression test.

### E4 Matcher That Excludes the Public Route

Request: an unauthenticated and an authenticated call against `/vendor/*` with the RegExp matcher.
Observed: `POST /vendor/accept-invite` without credentials returned 200; `GET /vendor/ping` without credentials returned 401; `GET /vendor/nope` with a token returned 404 and without a token 401.
Decision for the plans: the vendor chain uses the RegExp matcher `/^\/vendor(?!\/accept-invite\/?$)(\/.*)?$/`; routes that do not exist yet are covered by the chain.

### E5 Store Matcher and Query Reading

Request: `GET /store/products?fields=vendor_id`, `GET /store/regions`, `GET /store/products?limit=abc` with a publishable key.
Observed: the guard header was present on all three calls, including the core validation failure: yes (400 with header); `req.query.fields` has type `string` when present; reading the URL search parameters is a safe source (`new URL(req.originalUrl, "http://x").searchParams`).
Decision for the plans: the store guard uses matcher `"/store*"` and reads both `req.query.fields` and the URL search parameters.

### E6 Strict Body Validation

Request: `POST /spike/strict` with an unknown key and with a valid body.
Observed: the unknown key gave 400 with type `invalid_data` and message `Invalid request: Unrecognized fields: 'b'`; the valid body gave 200.
Decision for the plans: strict objects from `@medusajs/framework/zod` do reject unknown keys through the body validator; the message names the key.

### E7 Two-Step Sign-In for the Vendor Actor

Request: enrolment and challenge against the stock MFA routes.
Observed: the routes are `POST /auth/mfa/factors` (start; body `{ provider: "totp" }`; response keys `mfa_factor`, `secret`, `otpauth_url`), `POST /auth/mfa/factors/:id/verify` (confirm; body `{ code }`; response keys `mfa_factor`), `POST /auth/mfa/recovery-codes` (body `{ count }`; response keys `recovery_codes`, returned once; values `<redacted>`), and `POST /auth/mfa/challenges/:id/verify` (body `{ method, code }` with the first-factor bearer).
Observed: `mfa_enabled` was `false` before enrolment, `false` with the old token after enrolment and `true` after a fresh challenge-completed login; login after enrolment returns `mfa_challenge`, `mfa_required`, `token` and the challenge is answered by `POST /auth/mfa/challenges/:id/verify`; the session cookie works after enrolment.
Decision for the plans: the enrolled-session recipe for tests is login then challenge-verify with a TOTP from the enrolment secret (or mint a JWT with `mfa_enabled` true as in the staff helpers); the flag source is `req.auth_context.mfa_enabled`; the vendor MFA allowlist is `POST/GET /auth/mfa/factors`, `POST /auth/mfa/factors/:id/verify`, `DELETE /auth/mfa/factors/:id`, `POST /auth/mfa/recovery-codes`, `POST /auth/mfa/challenges/:id/verify`.

### E8 Password Change

Request: `POST /auth/vendor/emailpass/update` with a bearer token, then with the session cookie.
Observed: bearer 401 `Invalid token`; cookie 401 `Invalid token`; the stock update middleware only accepts a reset-password JWT (`purpose=reset` and `jti`); the old password was not required by that route and was never reached; the old password afterwards still works.
Decision for the plans: the profile screen changes the password by the fallback route `POST /vendor/me/password` with the body `{ current_password, new_password }` (re-authenticate the current password first). Stock `…/update` stays for the email reset-password flow only.

### E9 Session Cookie Flow

Request: login, `POST /auth/session` with the bearer token, a call with the cookie jar, `DELETE /auth/session`.
Observed: cookie name `connect.sid`, attributes HttpOnly, SameSite=Lax, Path=/, Domain absent (host-only), Secure absent in local development; the cookie call returned 200 with the same actor id; logout returned 200 and the next call 401.
Decision for the plans: the portal keeps the sign-in token in page memory and sends it as a Bearer header (owner decision, so no cookie is written on the host the admin uses). The cookie name observed here is `connect.sid` and is recorded only to show whether it would have collided with the admin session cookie.

## Decision

The vendor actor is confirmed as described in the nine lines above. Vendor routes sit behind `authenticate("vendor", ["session", "bearer"])`, the actor id is the vendor user id from `app_metadata.vendor_id`, and no stock registration route is reachable. Password change for a signed-in vendor uses a custom route, not stock `…/update`.

## Consequences

Later vendor work reads the `Decision for the plans` lines of this record instead of assuming a recipe. Where an observed result differs from the expected one, the work follows the record.

Undo cost: reversible, because the record only informs code that is not written yet.

## Alternatives Considered

- Making vendors a role of the staff user type: rejected because a vendor token must never reach admin routes.
- Skipping two-step sign-in for vendors: rejected because vendor accounts hold business contact data.
- Using stock `…/update` for profile password change: rejected because that route only accepts reset-password tokens.
