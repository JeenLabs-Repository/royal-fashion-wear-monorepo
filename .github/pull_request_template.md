<!-- Write from the commits and the diff only. Do not mention phases, plans or requirement numbers. Fill every section; write "None" where nothing applies. -->

## Summary

<!-- One short paragraph on what changes and why. -->

## Backend changes

<!-- Routes, modules, workflows, jobs and configuration that change. -->

- [ ] New or changed admin routes have rules in the permission manifest, and the route check passes (`pnpm --dir apps/backend run check:admin-routes`).
- [ ] New permission strings live only in the permission file `apps/backend/src/lib/rbac/permissions.ts`.
- [ ] New audit actions are in `apps/backend/src/lib/audit/actions.ts`, and the code records them with `recordAudit`.
- [ ] New emails use a typed template, and staff alerts use the staff alert helper.
- [ ] Any actor type gated by MFA uses the shared gate factory.

## Storefront changes

<!-- Pages, components and behavior that change. -->

## How it was tested

<!-- List the commands you ran and the results. Include the Playwright run and the production-build result. -->

## Migrations

<!-- State whether the database is backed up first and whether each migration is backward compatible. -->

## New or changed environment variables and secrets

<!-- Name each variable, where it is set and who provides the value. Never paste a value. -->

## Rollback plan

<!-- Name the previous image tag and the steps to return to it. -->

## Known risks

<!-- Adopting a third-party plugin requires a wrapper descriptor listed in config/plugin-descriptors.json. -->
<!-- Anything that could go wrong after release. -->

## Screenshots

<!-- Add screenshots for visible changes. -->
