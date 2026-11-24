# 0016 Integration Card Reader Behavior

Status: accepted

Date: 2026-11-25

## Context

Settings are read from the Integration Module at call time, with code defaults when a card is not available. This record states the exact call and what it returns in each state on Medusa 2.22.7 with `@gorgo/medusa-integration` 2.0.0.

## Observed

### E11 Settings Reader

Request: a scratch provider with identifier `integration-spike` (registration id `spike`), read through `medusa exec` in four states and once right after a save.
Observed: the reader import path and call are `import { INTEGRATION_MODULE } from "@gorgo/medusa-integration"` then `container.resolve(INTEGRATION_MODULE).getResolvedOptions(identifier, instanceId)` (positional args; instance id is the registration `id`, here `"spike"`). From an isolated module container the helper is `import { resolveIntegrationOptions } from "@gorgo/medusa-integration"` then `resolveIntegrationOptions({ identifier, instance_id })`. The return shape of `getResolvedOptions` is `{ options: Record<string, unknown>, meta: { provider_id, category, is_enabled } } | null`.
Observed: unsaved card: `getResolvedOptions` returns `null`; `resolveIntegrationOptions(…, { optional: true })` returns `null`; without `optional` it throws `Integration provider "integration-spike" is not available: it is either not configured, disabled, or missing required options. Configure and enable it before use.`
Observed: saved and enabled card with `n` 7 (and required `v`): after a fresh process (no stale cache) `getResolvedOptions` returns options including `n: 7` (and later `n: 9` after a further save). Persistence used `upsertIntegrationWorkflow` with `provider_id` from `integrationProviderKey(identifier, instanceId)` (value `int_integration-spike_spike`) plus `setIntegrationEnabledWorkflow({ provider_id, is_enabled: true })`.
Observed: disabled card: `getResolvedOptions` returns `null` (same as unsaved for consumers).
Observed: unknown identifier: throws `No integration provider registered for "int_integration-not-registered_default". Declare it in medusa-config under the integration plugin's options.providers.`
Observed: a read in the same process right after saving `n` 9 returned the stale cached value (previous `n`) when a prior read had filled the 60 s cache; `clearOptionsCache(provider_id)` then returned 9. The package emits `integration.updated` and ships an invalidate subscriber, but the immediate same-process read still served the stale entry during this spike. Callers that must see a write they just made should clear the cache or treat a prior null/old read as possibly sticky for up to 60 s.
Observed: the validation helpers are imported from `@gorgo/medusa-integration` as `collectValidationIssues` and `isDescriptorComplete`; called as `collectValidationIssues(descriptor, full)` and `isDescriptorComplete(descriptor, full)`; on the scratch descriptor with `{ n: 7, v: "x" }` they returned `[]` and `true`, and with `{ n: 7 }` alone `isDescriptorComplete` was `false`.
Decision for the plans: Reader call: `container.resolve(INTEGRATION_MODULE).getResolvedOptions(identifier, instanceId)` or `resolveIntegrationOptions({ identifier, instance_id }, { optional: true })`; unsaved card: `null` (throwing helper without `optional`); disabled card: `null`; unknown identifier: throws registration error; same-process read after save: may be stale for up to 60 s after a prior read — clear with `clearOptionsCache` or rely on a new process; descriptor test helpers: `collectValidationIssues` / `isDescriptorComplete` from `@gorgo/medusa-integration`.

## Decision

The adaptation file `src/lib/settings/resolve-options.ts` implements the call above and maps every unavailable state (`null` or the not-available throw) to code defaults. Incomplete or disabled cards are treated the same as unsaved.

## Consequences

Only one file knows how to call the Integration Module. A change in the package changes that file alone. App readers must not assume a write they just issued is visible in the same process without an explicit cache clear.

Undo cost: reversible, because the reader is one file.

## Alternatives Considered

- Reading settings in a constructor: rejected because the value would be stale until restart.
- Caching in the app: rejected because the module already caches for a short time per process.
