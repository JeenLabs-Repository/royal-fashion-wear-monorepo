# Staff Governance

This page explains how staff access works in the Admin. It covers who can do what, how every request is checked, how sign-in is protected and how actions are recorded. Read it before you add an admin route, a permission or an audit event. The task guides at the end tell you the steps.

## Five Roles Hold Fixed Sets of Permissions

A permission is a string in the form `resource:operation`. Every permission is declared once, in `apps/backend/src/lib/rbac/permissions.ts`, together with the role grants. A role is a named set of permissions. There is no role editor, so a change to a role is a code change.

| Role | What it can do |
|---|---|
| superadmin | Every permission, including staff management, integrations, audit log, vendor management and order writes |
| catalog_approver | Read vendors and the catalog, review and edit catalog entries |
| order_router | Read vendors, catalog, orders, customers, routing and returns, and assign, book and deliver routing, and write purchase invoices |
| support | Read vendors, orders, customers, routing and returns, decide returns and issue refunds |
| finance_readonly | Read vendors, catalog, orders, customers and routing, read finance data and documents, and export documents |

Three rules hold across the roles.

- No role except superadmin holds every permission. A test proves that the four other roles together still lack `staff:manage`, `integrations:manage`, `vendors:manage`, `audit:read` and `orders:write`.
- A user can hold several roles that are not superadmin. Their permissions are the union of the roles.
- Superadmin stands alone. The system refuses to combine it with another role.

The roles are written into the database on every start from the code file, so the code always wins over database rows. A user created outside the Staff page, for example with the stock `medusa user` command, has no assignment and is denied everywhere except the self routes.

## The Permission Manifest Denies by Default

`apps/backend/src/lib/rbac/permission-manifest.ts` lists rules. A rule has a method (or `*`), a path pattern, a permission and optional guard names. The matcher works on path segments and picks the most specific rule. A pattern that ends with `*` covers its segment and everything below it. A segment that starts with a colon matches one segment.

A route with no rule requires superadmin. That is the default deny, and it applies to every method. Besides the permission strings, a rule may use three pseudo permissions.

- `superadmin` allows only superadmins.
- `self` allows any signed-in staff user, even one with no role. It is limited to a short list of GET paths.
- `core-handled` marks a route that authenticates itself. Only the staff invite accept route uses it.

Two policy rules are tested. A mutating method never uses a read permission, and `self` never applies to a mutating method.

Before a path reaches the matcher, the normaliser lowercases it for matching, strips the query and semicolon parameters, decodes percent escapes once, collapses repeated slashes and rejects dot segments, backslashes and double encoding. A request with a bad path gets 400 `invalid_path`. This is why a variant such as `/Admin//Integrations;x=1` cannot reach a weaker rule.

## Every Admin Request Runs the Same Chain

`apps/backend/src/api/middlewares.ts` is the only middleware file. It spreads arrays that live under `apps/backend/src/lib`. For every `/admin*` request the steps run in this order.

1. Initialise. Accept or generate a request id, normalise the path, resolve the rule and mark preflight and `core-handled` requests.
2. Authenticate. Our own call accepts a session, a bearer token or an API key, so the chain never depends on the order core uses.
3. Refuse API keys. See the next section.
4. Check MFA enrolment. See the section on the gate.
5. Load the staff context. Confirm the user still exists, then read the user's assignments. Nothing is cached, so a role change applies on the next request.
6. Watch the break-glass account. See the section on break-glass.
7. Check the permission. No rule means superadmin. A user with no role gets 403 `no_staff_role`, and any other denial is 403 `permission_denied`.
8. Run guards. The `protect-staff-target` guard refuses changes to the break-glass account and refuses deleting the last superadmin.
9. Arm the audit writer. It records the request when the response finishes.

The order matters for three reasons. Authentication comes first because every later step needs the actor. The existence check comes before the assignment read so a deleted user's leftover assignments are never consulted. Guards run after the permission check so a caller without the permission learns nothing about the targets.

## Secret API Keys Are Refused on Every Admin Route

Staff use sessions or bearer tokens. A request authenticated with a secret API key gets 403 `api_key_not_allowed` on every admin route, not only on the integrations routes. The check compares the actor type against the literal `api-key`.

## The MFA Gate Forces Enrolment

`requireMfaEnrollment(actorType, { allowlist })` in `apps/backend/src/lib/mfa` returns a middleware. For the staff chain it answers 403 `mfa_enrollment_required` when the signed-in user has no verified TOTP factor. The allowlist lets the user reach the sign-in and enrolment endpoints under `/auth*`, `GET /admin/users/me`, `GET /admin/staff/me`, and the dashboard shell GETs the Security screen needs while enrolment is open (stores, layouts, modules, search indexes, notifications and cloud announcements). Nobody is exempt, including the break-glass account. The shell reads are listed in [Staff Dashboard Shell Reads](../decisions/0013-staff-dashboard-shell-reads.md).

Enrolled means a verified TOTP factor plus generated recovery codes. The server cannot prove that the user saved the recovery codes, because that is a step in the dashboard. The Auth module is configured with a disable policy of `challenge`, so a stolen session cannot switch MFA off.

The factory takes the actor type as its first argument. The vendor portal reuses it by creating a second instance with its own allowlist, and it follows the same per-request existence check that the staff context uses.

## Sessions and Tokens Have Fixed Lifetimes

The cookie session lasts 8 hours and the access token lasts 1 day. Both are set in `apps/backend/medusa-config.ts`. They are not shortened.

When you delete a staff user, their old token stays valid cryptographically until it expires. It authorises nothing, because the staff context checks that the user exists on every request and answers 401 `staff_user_not_found` otherwise. Leftover assignment rows are inert for the same reason.

## The Audit Log Is Append-Only

The `auditLog` module stores one row per recorded action. Each row has an id, the time, the actor id, type and label (the email at the time), the actor's roles, an action named `<domain>.<verb>`, a target type and id, before and after payloads, the HTTP method, path, matched route and status, the client IP, the raw first forwarded header, a truncated user agent, the request id and a small `meta` object. Every entry is also logged as one `[audit]` JSON line.

Two writers fill the table.

- The request writer records every non-GET admin request when the response finishes. It records key names only and never values. It also records rejected requests, every request by the break-glass account, and core-handled routes such as the invite accept route.
- `recordAudit` records an action with before and after values from inside a workflow step. It redacts any key that contains one of the words password, token, secret, key, otp, code, authorization, cookie or credentials.

Action names live in `apps/backend/src/lib/audit/actions.ts`. A change that writes a new action adds its name there first.

A database trigger rejects UPDATE, DELETE and TRUNCATE on the table. A test runs those statements through the application connection. The limit is that Medusa uses one database role for migrations and for running, so a role that owns the table can still drop the trigger. Off-host backups, monitoring and the `[audit]` log lines cover that gap.

A core `integration.updated` event writes an `integration.updated` entry that holds the integration id and the change history id only, never option values, because secrets can sit in a diff.

## Break-Glass Is a Sealed Account With an Alert and a Review

The break-glass account is one dedicated superadmin whose assignment carries a flag. It cannot be demoted, deleted, renamed or given other roles through any route. It does not count as the last superadmin, so at least one other superadmin must always remain.

The first authenticated request by the account in any 15-minute window opens the alert window. The window opens with an atomic lock acquire that expires after 900 seconds and is never released, so two simultaneous first requests give one alert. When a window opens, the backend logs an ERROR line starting `[break-glass] USED`, writes `break_glass.used`, opens a review row and emails the addresses in `BREAK_GLASS_ALERT_EMAILS`. A unique index on open reviews and the notification idempotency key keep a lost race harmless.

A superadmin other than the break-glass account closes the review on the Staff page. Closing needs a confirmation that the credentials were rotated and a note of at least 10 characters, and it writes `break_glass.reviewed`. A job at 09:00 IST emails the recipients every day while a review stays open for more than 24 hours. The account is never disabled automatically.

The alert is an email, so it depends on SMTP and on the app being up. The ERROR line and the audit row are the fallbacks until more alert channels exist. The recovery runbook in `docs/runbooks/staff-recovery.md` covers lost access and rotation.

## The Client IP Needs a Trusted Proxy Setting

The audit rows and the break-glass alert record `req.ip`. Behind a reverse proxy that is the proxy's address unless you tell the backend how many proxy hops to trust. Set `TRUST_PROXY_HOPS` to 0 in development and to the number of hops in production. The audit table also stores the raw first `x-forwarded-for` entry, so a wrong setting is visible in the log.

## The Dashboard Cannot Hide Menus

The Admin dashboard cannot hide menu entries per role. A role that lacks a permission still sees the entry, and the page's calls answer 403. The Staff and Audit log pages read the 403 and show a no-access message. The API is the security boundary, never the menu.

The dashboard also reads a few endpoints while it loads. Those that expose no business data are mapped to `self`, and [Staff Dashboard Shell Reads](../decisions/0013-staff-dashboard-shell-reads.md) lists them.

## Upgrades and Plugins Need a Mapping

`pnpm --dir apps/backend run check:admin-routes` lists every admin route from our code, from `@medusajs/*` packages and from the Gorgo integration package, and fails when a route matches no rule. After a Medusa upgrade or a new plugin, the check fails until you map each new route. Map by prefix family, and map anything that has no matching permission to superadmin.

## Related Pages

- [Add Permissions for a New Admin Route](../guides/add-admin-route-permissions.md)
- [Manage Staff and Recover Access](../guides/manage-staff-and-recovery.md)
- [Recover Staff Access](../runbooks/staff-recovery.md)
- [Custom Staff Roles and Audit Log](../decisions/0007-custom-staff-roles-and-audit-log.md)
