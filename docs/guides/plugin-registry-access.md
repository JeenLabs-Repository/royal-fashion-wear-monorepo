# Give Builds Read Access to the Plugin Registry

This guide explains how installs, CI and image builds read private plugin packages without writing a credential into a file or an image layer.

## 1. Know When the Credential Is Needed

Nothing needs the credential until the first plugin dependency is installed in the application. Before then, installs, CI jobs and image builds all work without it, because the `.npmrc` line resolves to an empty token and the backend secret mounts are optional.

The change that adds the first plugin dependency also changes every backend secret mount to required. From then on a build without the credential fails, and the Dockerfile guard fails if the mounts are still optional.

## 2. Create the Token

1. Open GitHub, then Settings, Developer settings, Personal access tokens (classic).
2. Create a token with only the `read:packages` scope and a short expiry you will remember to rotate.
3. Copy it once. Do not paste it into any file in the repository.

## 3. Store the Token

1. Open the application repository, then Settings, Secrets and variables, Actions.
2. Add a repository secret named `PLUGIN_REGISTRY_TOKEN` with the token as its value.
3. For local installs, export `NODE_AUTH_TOKEN` in your shell once a plugin is installed, then run `sh scripts/write-registry-userconfig.sh` once per machine (or add the same `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` line to your user `~/.npmrc`). pnpm 12 ignores environment tokens in the repository `.npmrc`, so the user-level file is what the installer reads. Never write the literal token into any repository file. Gitleaks and the commit hook reject token-shaped strings.

## 4. Know What Each Place Does With It

| Place | How it gets the credential |
|-------|----------------------------|
| CI install steps | The workflow environment sets `NODE_AUTH_TOKEN` from the repository secret. |
| Backend image build | The images workflow passes it as a BuildKit secret. The Dockerfile mounts it for the install and deploy steps only, so it is absent from every layer. |
| Storefront image build | The storefront depends on no private package, so it sets a dummy value for the install command only. |
| The server | It never holds the credential. It only pulls finished images. |
| Your shell | You export `NODE_AUTH_TOKEN` before `pnpm install` once a plugin is installed. |

## 5. Rotate the Token

Follow this rotation routine before the expiry date or after any suspected exposure.

1. Create the new token with `read:packages`.
2. Update the `PLUGIN_REGISTRY_TOKEN` secret.
3. Run CI on the default development branch and confirm the install steps pass.
4. Revoke the old token.

## 6. Switch to the Workflow Token

You can drop the personal token when the application repository has read access to each plugin package.

1. In each plugin package's settings on GitHub, add the application repository with read access.
2. In `ci.yml` and `images.yml`, replace `secrets.PLUGIN_REGISTRY_TOKEN` with `secrets.GITHUB_TOKEN`.
3. Add `packages: read` to the top-level permissions of `ci.yml`.
4. Run CI and a test image build, then delete the `PLUGIN_REGISTRY_TOKEN` secret.

## 7. Fix Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| An install or image build fails after a plugin was added | The credential is missing | Export `NODE_AUTH_TOKEN` locally or add the repository secret. |
| An authentication error from the registry | The token lacks `read:packages` or has expired | Create a new token and rotate it in. |
| A 404 for a package | The scope does not match the registry file, or the package grants no access to this repository | Compare the scope in `config/plugin-registry.json` with the package name and grant access in the package settings. |
