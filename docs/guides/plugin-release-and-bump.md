# Release A Plugin And Bump The App Pin

This guide shows the routine that moves a plugin change into the app. You change two repositories, in this order.

## Steps

1. In the plugin repository, land the change on `active-dev` with its tests and documentation.
2. Promote it with the same signed merge and pull request routine as the app. See [Repository Setup](repository-setup.md) and [Release](release.md).
3. On `main`, create the signed tag with the plugin's release scripts.
4. Push the tag. The publish workflow verifies the tag signature, checks that the version equals the one in `package.json`, and publishes the package.
5. Confirm the release is visible.

   ```sh
   npm view <package>@<version> version --registry <registry>
   ```

6. In the app on `active-dev`, pin the new version.

   ```sh
   sh scripts/bump-plugin.sh <repo-name> <version>
   ```

7. Run the tests and builds, commit the three changed files with the message the script prints, and describe the bump in the next promotion notes.

A settings card added to `medusa-store-settings` is usable in the app only after this routine.

## Roll Back A Bump

Run the bump script with the previous exact version, run the tests, and commit. The script refuses versions that are not published, so the previous version is always available.

## Version Rules

Saved settings depend on option keys, so the version number tells you what a change does to them.

| Change | Version bump |
|--------|--------------|
| Add an option | Minor |
| Fix a defect | Patch |
| Rename or remove an option | Major |
| Change a default value | Major |
