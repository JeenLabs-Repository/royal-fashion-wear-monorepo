# Adopt a Plugin

Follow these steps when the store needs a third-party plugin that has settings. A plugin counts as adopted only when its settings appear in Settings, Integrations through a wrapper descriptor.

## Before You Start

You need access to the settings plugin repository and a plugin release routine that works. Read [Plugin Release and Bump](plugin-release-and-bump.md) and [Settings Boundary](../concepts/settings-boundary.md) first. The card contract in the settings plugin repository describes what a card must define.

## Steps

1. Write the wrapper card in `medusa-store-settings`. Create `src/providers/integration-<name>/`, name the folder after the card identifier and follow the card contract. Mark every credential option as a secret.
2. Add the card to the plugin's card registry, write its unit tests and release a new version of the settings plugin.
3. Bump the application pin with `sh scripts/bump-plugin.sh medusa-store-settings <version>`.
4. Add the third-party plugin to `config/plugin-registry.json` if it is one of your own plugins. For other packages, add it to the dependency list of `apps/backend/package.json` at an exact version.
5. Add the plugin and the card to `config/plugin-descriptors.json`. List the card identifier under the package name.
6. Register both in `medusa-config.ts` by package path. The card goes in the Integration Module `providers` array with a path ending in `/providers/integration-<name>`.
7. Add a typed reader in `apps/backend/src/lib/settings/<name>.ts`. It reads the card at call time and returns code defaults when no card exists.
8. Run the two settings tests.

```sh
pnpm -C apps/backend run test:unit --testPathPattern="integration-descriptors|no-env-settings"
```

9. Note the adoption in the pull request description under Known risks.

## What Failing Looks Like

A failing adoption test names the package or card that is missing. Fix the map or the registration, not the test. If the plugin reads a setting from the environment, move that setting into its card, because the second test fails on any such read.
