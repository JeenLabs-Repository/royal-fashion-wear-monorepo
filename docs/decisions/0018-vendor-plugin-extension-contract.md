# 0018 Vendor Plugin Extension Contract

Status: accepted

Date: 2026-11-25

## Context

A compliance plugin will be built later in its own repository. It must block activation, add rules to locations, react to suspension and add onboarding steps and admin links without changes to core code.

## Decision

The file `src/modules/vendor/public.ts` is the contract. It exports the three hook helpers, `authenticateVendor`, `assertOwns`, `requireVendor`, `defineAllowlistSerializer`, `recordAudit`, `registerOnboardingStep`, `registerVendorAdminSection`, the module key and the payload types. The names are frozen. A handler that throws a `MedusaError` blocks the parent workflow and its message reaches the owner unchanged. Any number of handlers can attach to a hook. A test pins the export list and a stub plugin that imports only this file proves the surface is enough.

## Consequences

A plugin author learns one import path. A rename needs a deprecation note and a replacement that keeps the old name. The later plugin package either publishes this surface or shares it, and that choice is made when the plugin is extracted.

Undo cost: costly, because a published plugin depends on every name.

## Alternatives Considered

- Let the plugin import internal files. Rejected because any refactor would break it.
- Use events and subscribers only. Rejected because a subscriber cannot block a workflow or show a message to the owner.
