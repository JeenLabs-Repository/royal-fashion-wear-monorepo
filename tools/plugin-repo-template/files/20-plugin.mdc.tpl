---
description: Rules for source files in this plugin package
globs: src/**
alwaysApply: false
---

- This package imports nothing from the app. No relative path leaves the repository and no application package is imported.
- Add a public export only through `src/public.ts` and the package `exports` map, and document it in `docs/` in the same change.
- Read every settings card option at call time through the Integration Module. Never read one from the environment, and never cache one without a short expiry.
- Mark secret options `secret: true` with `control: "secret"` and give required strings `minLength: 1`.
- Put a payment or notification provider at `src/providers/<name>/index.ts` and a module at `src/modules/<name>`.
- Generate migrations with `pnpm run db:generate` and commit them with the model change.
- Put unit tests under `src/**/__tests__/*.unit.spec.ts` and module integration tests under `src/modules/*/__tests__`.
