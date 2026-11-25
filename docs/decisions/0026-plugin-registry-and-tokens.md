# Plugin Registry, Scope And Token Behaviour

Status: accepted

Date: 2026-11-25

## Context

The store installs its plugins from a private npm registry. GitHub Packages is the proposal. Scope naming, how `.npmrc` handles an unset token variable, what a package contains when published and how a CI job in another repository reads a private package were read from documentation and never run, so each was observed with a throwaway package and consumer. `NODE_AUTH_TOKEN` was absent on this host; write publish to GitHub Packages was not attempted with a real token.

## Observed

### P6 Interpolation of the token variable

| Run | Exit code | Message |
|---|---|---|
| token variable unset in project `.npmrc` as `${NODE_AUTH_TOKEN}` | 1 | pnpm warns `Ignored project-level auth setting "//npm.pkg.github.com/:_authToken": environment variables are not expanded in repository-controlled registry credentials`; then `ERR_PNPM_FETCH_404` with `No authorization header was set for the request` |
| token variable set to a placeholder with the same project `.npmrc` | 1 | Same ignore warning and `No authorization header was set` (project `.npmrc` auth line never applied) |
| default syntax `${NODE_AUTH_TOKEN-}` in project `.npmrc`, unset | 1 | Same ignore warning and no authorization header |
| scope-only project `.npmrc` plus `pnpm config set //npm.pkg.github.com/:_authToken unused-value --location global` | 1 | `ERR_PNPM_FETCH_404` but help text says `An authorization header was used: Bearer [hidden]` (package absent; auth header present) |
| `file:../plugin-spike` local install with no registry auth | 0 | Install succeeds |

Decision for the plans: commit only `@jeenlabs-repository:registry=https://npm.pkg.github.com` in the repository `.npmrc` (no `_authToken` line in tracked files); supply the token outside the repo via `pnpm config set //npm.pkg.github.com/:_authToken <token> --location global` (or an untracked / CI-generated npmrc), and in Docker via a BuildKit secret mount that writes the same auth into the install environment; jobs that do not need the private registry must not depend on an expanded project auth line (pnpm will not expand it anyway) and should omit the private scope or use a public lockfile path that does not fetch that scope.

### P7 Publish dry run and tarball

Tarball files: `dist/index.js`, `package.json` only (`NOTES.txt` excluded by `"files": ["dist"]`). Dry-run publish to `https://npm.pkg.github.com`: exit 0 with notice that login is required for a real publish; npm normalized `repository.url` to `git+https://github.com/jeenlabs-repository/plugin-spike.git`. The scope must be lowercase and equal the owner name: observed package name `@jeenlabs-repository/plugin-spike` matches org `JeenLabs-Repository` lowercased. The `repository` field is required: present; npm warns and rewrites the URL form on publish.

Publishing and cross-repository read access cannot be proven before the first real package exists; the first release proves them. Blocker without `NODE_AUTH_TOKEN`: no live publish or private install from GitHub Packages was run.

Decision for the plans: template `files` must list only the build output (for Medusa plugins `.medusa/server` plus `package.json` via the default pack rules); `publishConfig.registry` is `https://npm.pkg.github.com`; `repository.url` points at `https://github.com/jeenlabs-repository/<repo>.git` (npm may rewrite to `git+https://…`); package name scope is `jeenlabs-repository`.

### P7b CI read credential

Two ways a job in the application repository can read a private package of another repository: the workflow token after the package grants the application repository read access (package settings, manage Actions access), or a classic personal access token with `read:packages` stored as a repository secret named `PLUGIN_REGISTRY_TOKEN`.

The Dockerfile rule: the token reaches the image build only through a BuildKit secret mount, never an argument or environment variable:

```dockerfile
RUN --mount=type=secret,id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN \
    pnpm config set //npm.pkg.github.com/:_authToken ${NODE_AUTH_TOKEN} --location global && \
    pnpm install --frozen-lockfile
```

Decision for the plans: Default: option two until the first release proves option one works; at that point switch to option one and remove the secret.

### P8 Settings reader

Reused `docs/decisions/0016-integration-card-reader-behavior.md`. Decision for the plans (from that record): Reader call: `container.resolve(INTEGRATION_MODULE).getResolvedOptions(identifier, instanceId)` or `resolveIntegrationOptions({ identifier, instance_id }, { optional: true })`; unsaved card: `null` (throwing helper without `optional`); disabled card: `null`; unknown identifier: throws registration error; same-process read after save: may be stale for up to 60 s after a prior read — clear with `clearOptionsCache` or rely on a new process; descriptor test helpers: `collectValidationIssues` / `isDescriptorComplete` from `@gorgo/medusa-integration`.

Called from inside a payment provider: `resolveIntegrationOptions` is importable; an unregistered identifier throws `No integration provider registered for "int_integration-spike_…"` even when `{ optional: true }` is passed. Called from inside a notification provider: the same throw for the same attempts. App readers must map that throw to code defaults (same as 0016).

Decision for the plans: providers call `resolveIntegrationOptions` at call time (not in the constructor) and treat both null and the not-registered throw as code defaults; typed readers stay in the app per D-A1.

## Decision

GitHub Packages under scope `jeenlabs-repository` is the registry shape to wire: scope-only committed `.npmrc`, token only via global or secret-mounted config, BuildKit for image builds, `PLUGIN_REGISTRY_TOKEN` until Actions package access is proven, and Integration options read from providers with throw-to-defaults mapping already recorded in 0016 and confirmed from payment and notification providers here.

## Consequences

The plugin install plan must not commit `${NODE_AUTH_TOKEN}` in `.npmrc` expecting pnpm to expand it. Dockerfiles and CI need an explicit config-set or generated npmrc step. The first real publish remains an owner checkpoint once a write token exists.

Undo cost: reversible, because only decision records remain and no package was published to GitHub Packages.
