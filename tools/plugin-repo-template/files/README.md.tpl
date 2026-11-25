# @@PACKAGE@@

@@DESCRIPTION@@

## Install

Add the registry line to the `.npmrc` of the application that installs this package.

```text
@@SCOPE@@:registry=@@REGISTRY@@
```

Export a personal access token with the `read:packages` scope as `NODE_AUTH_TOKEN` before you run `pnpm install`. The store application pins an exact version of this package and never a range.

## Learn More

- Start with `docs/guides/getting-started.md` to set up this repository.
- Read `docs/guides/release.md` before you cut a release.
- See `docs/decisions/README.md` for the decision record index.
