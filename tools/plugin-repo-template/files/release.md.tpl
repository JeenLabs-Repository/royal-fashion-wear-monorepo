# Release the Plugin

This guide takes finished work on `active-dev` to a published package version.

## Steps

1. Land all work on `active-dev` with its tests and docs.
2. Choose the next version with the table below.
3. Set the `version` field in `package.json` in its own commit with the message `build: set version to <x.y.z>`.
4. Run `pnpm run release:prepare v<x.y.z>`. It writes the changelog commit.
5. Promote `active-dev` to `dev` with a signed merge.
6. Open the pull request from `dev` to `main` and merge it with a merge commit.
7. Switch to `main` and run `pnpm run release:tag v<x.y.z>`. It creates a signed annotated tag.
8. Push the tag. The publish workflow runs `scripts/verify-release-tag.sh` and publishes the package to the registry.
9. Confirm the release with `npm view @@PACKAGE@@@<x.y.z> version`.
10. Tell the application owner to bump the pinned version.

## Choosing the Version

| Change | Version |
|---|---|
| New option, new public export or a fix | minor or patch |
| Renamed or removed option or export | major |
| Changed default value | major |

## Rolling Back

Re-pin the previous exact version in the application. Never delete or move a published tag.
