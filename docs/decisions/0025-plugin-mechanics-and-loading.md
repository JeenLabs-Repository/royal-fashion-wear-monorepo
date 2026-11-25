# Plugin Build, Loading And Isolation On Medusa 2.22.7

Status: accepted

Date: 2026-11-25

## Context

The Razorpay provider and the settings cards live in their own plugin packages that the store installs from a private registry. That layout only works if a plugin can carry a payment provider, a module and a webhook guard, can be loaded by package path, and can be developed against the store without leaving traces in it. Each assumption was read from documentation and never run, so each was observed on a running application with a throwaway plugin before any plugin repository was created.

## Method

Medusa 2.22.7 exactly. A hand-written plugin `@spike/plugin-spike` (provider, module with one model, middleware route, admin route, workflow, job, subscriber) was built and published to the local yalc registry, then added to a throwaway worktree of the store application with a scratch database. No package scaffolder was used. All scratch files and the database were deleted afterwards.

## Observed

### P1 Build

Command: `pnpm exec medusa plugin:build`.

Output tree under `.medusa/server` (depth 4):

```
.medusa/server
.medusa/server/src
.medusa/server/src/admin
.medusa/server/src/admin/index.js
.medusa/server/src/admin/index.mjs
.medusa/server/src/api
.medusa/server/src/api/admin
.medusa/server/src/api/admin/spike
.medusa/server/src/api/middlewares.js
.medusa/server/src/api/spike-guard.js
.medusa/server/src/jobs
.medusa/server/src/lib
.medusa/server/src/modules
.medusa/server/src/modules/spike-ledger
.medusa/server/src/providers
.medusa/server/src/providers/spike-notification
.medusa/server/src/providers/spike-payment
.medusa/server/src/subscribers
.medusa/server/src/workflows
```

Admin bundle without `src/admin`: server compile still emits API/jobs/modules/providers; the admin Vite step fails with `ENOENT` on `__admin-extensions__.js` unless an empty `src/admin` exists, and needs `@medusajs/admin-shared@2.22.7` as a plugin devDependency for a clean admin build. With those present, empty admin still produces `admin/index.js` and `admin/index.mjs`. Build with the `./admin` exports entry removed: server compile still succeeds; admin Vite still runs and still needs the same support.

Decision for the plans: keep the Medusa docs exports map (`./package.json`, `./workflows`, `./.medusa/server/src/modules/*`, `./modules/*`, `./providers/*`, `./admin` with import/require/default, `./*`); always ship an empty `src/admin` plus `@medusajs/admin-shared` at 2.22.7 so `plugin:build` completes cleanly even when the plugin has no Admin UI.

### P2 Local loop

Commands: `plugin:publish`, `plugin:add`, then the reset recipe.

`git diff` after `plugin:add`: `apps/backend/package.json` gains `"@spike/plugin-spike": "file:.yalc/@spike/plugin-spike"`; `pnpm-lock.yaml` gains a `file:apps/backend/.yalc/@spike/plugin-spike` importer entry; `apps/backend/.yalc/` and `yalc.lock` appear. `plugin:publish` requires `yalc` installed in the plugin (without it the CLI throws `TypeError: cmd is not a function`).

Tree after the reset recipe (`git checkout -- apps/backend/package.json pnpm-lock.yaml && rm -rf apps/backend/.yalc apps/backend/yalc.lock && pnpm install --frozen-lockfile`): clean. Time from saving a provider change under `plugin:develop` to the file appearing under the app's `.yalc` / `node_modules` copy: about 0.5 s for the push after a ~1.7 s rebuild; a running Node process still needs a restart to load the new provider code.

Decision for the plans: local loop is `medusa plugin:publish` in the plugin and `medusa plugin:add <name>` in the app (yalc in both); reset with checkout of `package.json` and the lockfile, delete `.yalc` and `yalc.lock`, then `pnpm install --frozen-lockfile`; guards must reject `.yalc/`, `yalc.lock`, and any `file:.yalc/` dependency from commits.

### P3 Loading

| Registration | Module `spikeLedger` registered | Job ran | Subscriber received event | `GET /admin/spike` | Plugin middlewares applied |
|---|---|---|---|---|---|
| plugin entry only | yes (container.resolve) | yes (`[spike-job] ran`) | yes (`product.created`) | 200 with staff token | yes (webhook guard logged) |
| plugin entry and module entry | yes | yes | yes | 200 | yes |

Migration: generated at `src/modules/spike-ledger/migrations/Migration20261125144345.ts` via `medusa plugin:db:generate` with `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD` (and `DATABASE_URL`); empty `DB_PASSWORD` fails SASL. Table `spike_event` present after the application's `medusa db:migrate`.

Decision for the plans: a `plugins: [{ resolve: "@scope/pkg", options: {} }]` entry alone loads the plugin module, jobs, subscribers, API routes and plugin `src/api/middlewares.ts`; an explicit `modules` entry is optional for that module; migrations live under the plugin module's `migrations/` folder and are applied by the app's `medusa db:migrate` after the built plugin is installed.

### P4 Provider registration by package path

Block used: `providers: [{ resolve: "@spike/plugin-spike/providers/spike-payment", id: "spike", options: {} }]` under the payment module.

Provider id seen: `pp_spike_spike`. Listed by the admin providers route: yes. System provider still listed: yes (`pp_system_default` remains enabled alongside the custom provider).

Decision for the plans: register payment providers with that `resolve` / `id` / `options` shape under `@medusajs/medusa/payment`; the composed id is `pp_<identifier>_<id>`; keeping India free of the system provider is a region seed and provider-list concern, not automatic when a custom payment module block exists.

### P5 Isolation and the webhook guard

Constructor container keys: payment-module services only (`paymentSessionService`, `pp_spike_spike`, `pp_system_default`, …); no `spikeLedger`. `initiatePayment` input keys: `amount`, `context`, `currency_code`, `data`; context keys: `idempotency_key`; the idempotency key equals the payment session id: yes (`payses_…` in both the log and `data.idempotency_key`).

Integration options reader from the payment provider: `resolveIntegrationOptions` imports from `@gorgo/medusa-integration`; an unsaved / unregistered descriptor throws `No integration provider registered for "int_integration-spike_…"`. From the notification provider: the same throw for the same attempts. Unsaved descriptor result: registration error (not a soft null) when the provider is not declared in the Integration plugin's `providers` list.

Webhook guard: plugin-registered handler ran yes, raw body is a Buffer yes, custom module resolved yes (`resolved-and-wrote`), answering without calling next skipped the core route yes (`{"answered_by":"guard"}` and no provider webhook log); app-registered variant yes (`import { spikeGuardRoute } from "@spike/plugin-spike/api/spike-guard"` resolves via `./*`); provider-side raw data type Buffer (`raw_is_buffer: true`); header key casing lowercase (`x-razorpay-signature` among keys).

Decision for the plans: Razorpay `receipt` comes from `input.context.idempotency_key`, which equals the payment session id; a provider reads Integration options with `resolveIntegrationOptions({ identifier, instance_id }, { optional: true })` but must still map the "not registered" throw to code defaults; a payment provider cannot resolve a custom app or plugin module from its isolated container; the webhook guard may live in the plugin's `src/api/middlewares.ts` (auto-loaded) or be re-exported into the app's `src/api/middlewares.ts`, and must use `bodyParser: { preserveRawBody: true }`.

## Decision

Plugins for this store use the observed exports map and empty-admin build support, the yalc publish/add loop with a strict reset recipe, plugin registration by package name (module entry optional), payment registration by `@scope/pkg/providers/...` producing `pp_<identifier>_<id>`, receipt from the payment-session idempotency key, Integration options read at call time with throw-to-defaults mapping, and a raw-body webhook guard that can load from the plugin or from the app middleware file. Custom modules stay out of the payment provider container; middleware and routes that need them resolve them from `req.scope`.

## Consequences

The plugin-repo template can hard-code the exports map, `yalc` as a plugin tooling dependency, and the reset/guard rules. Provider plans must not call custom modules from inside the payment provider. India region seeding must explicitly omit `pp_system_default`. Later plans may register the Razorpay webhook guard from the plugin package path without copying source into the app.

Undo cost: reversible, because only decision records remain and no plugin package was published to a shared registry.
