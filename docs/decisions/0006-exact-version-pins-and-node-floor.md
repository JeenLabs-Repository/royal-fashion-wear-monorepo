# 0006 Exact Version Pins and Node Floor

Status: accepted

Date: 2026-11-24

## Context

Floating versions and a wide Node range make builds differ between machines and over time.

## Decision

Pin every `@medusajs/*` package at exactly 2.22.7, all together. One documented exception exists. `@medusajs/ui` follows its own version line and is pinned exactly at 4.2.14. Pin `@gorgo/medusa-integration` to the version the lockfile resolved, 2.0.0, with no `latest` and no caret on any of these. Enforce Node 22.23.4 or newer through `engines`, `.nvmrc`, Dockerfiles and CI. Use pnpm 12.18.0 only (`packageManager` and `engines.pnpm` for the 12.x line), commit the lockfile and freeze installs. Treat the Medusa 2.23 upgrade as its own later release, because it brings Express 5, React 19, Vite 8 and Tailwind 4 together.

## Consequences

Upgrades are deliberate and one at a time. A guard in CI fails when a pin drifts.

Undo cost: costly, because the pins touch manifests, images and CI together.

## Alternatives Considered

- Caret ranges. Rejected because they let builds change without a commit.
- Upgrade to 2.23 now. Rejected because the bundled upgrades are too large for the launch path.
