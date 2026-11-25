# Try A Plugin Change Locally Before You Release It

This guide shows how to run a plugin from your working copy inside the app. The trial edits files you must never commit, and the last step removes them.

## Before You Start

You need the plugin repository and the app repository checked out side by side, and both installed with `pnpm install`.

## Steps

1. In the plugin repository, start the watcher.

   ```sh
   pnpm exec medusa plugin:develop
   ```

2. In the app, add the plugin from `apps/backend`.

   ```sh
   cd apps/backend
   pnpm exec medusa plugin:add <package>
   ```

   Use the package name from `config/plugin-registry.json`.

3. Start the app, try the change, and stop the app.
4. Reset the app to its committed state.

   ```sh
   sh scripts/bump-plugin.sh --reset
   ```

## What The Trial Changes

The trial edits `apps/backend/package.json` and the lockfile and creates `.yalc` folders and `yalc.lock`. The `.gitignore` hides the last two. Never commit the first two while a trial is active. The guard `check-plugin-refs` fails when a manifest holds a local path.

If you staged a trial change by mistake, unstage it with `git restore --staged apps/backend/package.json pnpm-lock.yaml`, then run the reset step.

## Installing Released Versions

Released versions come from the private registry. Set a personal access token that can read packages in your shell as `NODE_AUTH_TOKEN`. Never write the token to a file. Supply auth through your user-level npm config (or a CI secret mount), not through a committed project `.npmrc` auth line.
