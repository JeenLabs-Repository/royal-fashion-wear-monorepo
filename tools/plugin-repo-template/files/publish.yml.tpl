name: publish

on:
  push:
    tags:
      - "v*"

permissions:
  contents: read

env:
  GORGO_DISABLE_TELEMETRY: "true"
  MEDUSA_DISABLE_TELEMETRY: "true"
  HUSKY: "0"

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: @@USES_CHECKOUT@@
        with:
          fetch-depth: 0
      - uses: @@USES_PNPM@@
      - uses: @@USES_SETUP_NODE@@
        with:
          node-version-file: .nvmrc
          cache: pnpm
          registry-url: @@REGISTRY@@
          scope: "@@SCOPE@@"
      - run: pnpm install --frozen-lockfile
      - name: Verify the tag
        env:
          TAG_NAME: ${{ github.ref_name }}
        run: sh scripts/verify-release-tag.sh "$TAG_NAME"
      - run: pnpm run typecheck
      - run: pnpm run test:unit
      - run: pnpm run build
      - name: Publish the package
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm publish --no-git-checks
