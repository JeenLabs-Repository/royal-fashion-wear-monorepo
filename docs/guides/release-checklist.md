# Ship a Release

This checklist covers one release from the last commit on `active-dev` to a signed tag on `main` with images in the registry. [release.md](release.md) explains the version rules and the scripts. [repository-setup.md](repository-setup.md) explains the branch rules this routine follows, what GitHub enforces on your plan and the weekly audit.

## A Release Is Done When

Check every item before you open the pull request to `main`.

- Tests are green, including the guards, the backend suites and the Playwright specs for every new flow.
- You checked the changed screens by hand, fixed what looked wrong and retested.
- Docs and decision records describe the new behavior, and they changed in the same commits as the code.
- You ran the production build and tested it on the compute engine, never on the live server. The test used separate accounts, and you deleted them afterwards.
- The pull request notes come from the commits and the diff only, with every section filled.
- The signed tag exists and the changelog section was generated from the commits.
- You recorded whether the setup script ended with `ENFORCEMENT: SERVER` or `ENFORCEMENT: LOCAL ONLY`, and you ran the weekly audit from the repository setup guide. On the free plan with a private repository GitHub enforces nothing, so you merge into `dev` and `main` only through pull requests after a green `ci-gate`.

## Enforcement Record

Fill this in when you first publish the repository, and update it if the plan changes.

| Field | Value |
|---|---|
| Setup script outcome | _owner fills: `ENFORCEMENT: SERVER` or `ENFORCEMENT: LOCAL ONLY`_ |
| First-publication baseline commit | _owner fills: `git rev-parse origin/main` right after the first push_ |
| Weekly audit last run | _owner fills: date and result_ |

On the free plan with a private repository, local hooks and CI checks are the enforcement. Merge into `dev` and `main` only through pull requests after a green `ci-gate`.

## Run the Release Routine

Each step names the branch you stand on.

1. On `active-dev`, run every automated check.

   ```sh
   sh scripts/verify-baseline.sh --with-integration --with-images --with-e2e
   ```

   Expect only `[PASS]` lines and exit code 0. Start the dev stack and the apps first, because the browser specs need a running stack.

2. On `active-dev`, generate the changelog section.

   ```sh
   pnpm release:prepare vX.Y.Z
   ```

   Expect a signed commit named `docs: update changelog for vX.Y.Z`.

3. Promote to `dev` through a pull request from `active-dev`. Push `active-dev`, open the pull request, wait until the `ci-gate` check is green (GitHub may let you merge on a red check, so look first) and choose "Create a merge commit". Never push `dev` directly.

   ```sh
   git fetch origin
   git switch dev
   git pull --ff-only origin dev
   ```

   Wait until the `ci-gate` check passes on `dev`.

4. From `dev`, run the production-like test as described in [deploy-dokploy.md](deploy-dokploy.md).

   ```sh
   sh scripts/local-prod.sh up
   ```

   Confirm the output includes `Demo products after migrate: 0` and `Browser path OK`. Run the browser specs against it, run the session restart proof, check the storefront and the Admin by hand, then delete the throwaway account or run `sh scripts/local-prod.sh reset`.

5. Open the pull request from `dev` to `main` with the repository template. Wait for a green `ci-gate` and `pr-notes`, then merge it with "Create a merge commit".

6. On `main`, create the signed tag and publish it.

   ```sh
   git switch main
   git pull --ff-only origin main
   pnpm release:tag vX.Y.Z
   OWNER_PROMOTION=1 git push origin vX.Y.Z
   ```

   The tag script prints `Good "git" signature` before it finishes. It never pushes.

7. Wait for the images workflow to succeed, then check that both images pull.

   ```sh
   gh run list --workflow images --limit 1 --json conclusion --jq '.[0].conclusion'
   docker pull ghcr.io/<owner>/<repo>/backend:vX.Y.Z
   docker pull ghcr.io/<owner>/<repo>/storefront:vX.Y.Z
   ```

8. Merge `main` back so the branches do not drift. Open a pull request from `main` to `dev`, merge it with "Create a merge commit" after a green `ci-gate`, then update `active-dev` locally.

   ```sh
   git fetch origin
   git switch dev
   git pull --ff-only origin dev
   git switch active-dev
   git merge --no-ff -S dev -m "chore: merge dev into active-dev"
   ```

## Run the First Deploy

You do this once, after the first release tag exists. It runs the migration, then the bootstrap script, then prints the publishable key you copy into the storefront settings.

1. The images workflow builds both images from the tag. The storefront job stops with a message that names `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` while that variable is empty. The backend job still pushes its image.
2. In Dokploy, deploy the backend with `RUN_MIGRATIONS=true`. The entrypoint runs the migration, which creates no demo data. Read the start log to confirm the migration ran. The bootstrap script in the next step prints the Postgres major of the server it reached. Check that it equals the major your database host runs.
3. Run the bootstrap script once inside the backend container.

   ```sh
   docker exec <backend-container> sh -c 'cd /app/.medusa/server && /app/node_modules/.bin/medusa exec ./src/scripts/bootstrap-production.js'
   ```

   It creates the INR store settings, the India region with tax-inclusive pricing, the default sales channel and a publishable key. It prints the key id and the key token. Run it again and it prints `already present` for each item.
4. Copy the printed token into the repository variable, re-run the failed storefront job for the tag, then set `STOREFRONT_IMAGE` in Dokploy and deploy the storefront. A publishable key is public by design.

   ```sh
   gh variable set NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY --body "<printed token>"
   ```

## Roll Back by Pointing at the Previous Tag

The images are tagged by release, so a rollback needs no rebuild. In Dokploy, set `BACKEND_IMAGE` and `STOREFRONT_IMAGE` to the previous tag and redeploy. Back up the database before every release that includes migrations, and keep migrations backwards compatible so the previous tag still runs against the migrated schema.
