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
