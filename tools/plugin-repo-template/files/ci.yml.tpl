name: ci

on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main, dev]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  GORGO_DISABLE_TELEMETRY: "true"
  MEDUSA_DISABLE_TELEMETRY: "true"
  HUSKY: "0"

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: @@USES_CHECKOUT@@
      - uses: @@USES_PNPM@@
      - uses: @@USES_SETUP_NODE@@
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: @@USES_CHECKOUT@@
      - uses: @@USES_PNPM@@
      - uses: @@USES_SETUP_NODE@@
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run typecheck

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: @@USES_CHECKOUT@@
      - uses: @@USES_PNPM@@
      - uses: @@USES_SETUP_NODE@@
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
      - name: Check the package contents
        run: |
          npm pack --dry-run --json --ignore-scripts > pack.json
          node -e "const files=JSON.parse(require('fs').readFileSync('pack.json','utf8'))[0].files.map(f=>f.path);const bad=files.filter(p=>p!=='package.json'&&!p.startsWith('.medusa/server/')&&!/^(README|LICENSE|LICENCE)/i.test(p));if(bad.length){console.error('Unexpected files in the package: '+bad.join(', '));process.exit(1)}console.log(files.length+' files in the package')"

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:${{ vars.POSTGRES_VERSION || '17' }}
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DB_HOST: localhost
      DB_USERNAME: postgres
      DB_PASSWORD: postgres
    steps:
      - uses: @@USES_CHECKOUT@@
      - uses: @@USES_PNPM@@
      - uses: @@USES_SETUP_NODE@@
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run test:unit
      - run: pnpm run test:integration:modules

  guards:
    runs-on: ubuntu-latest
    steps:
      - uses: @@USES_CHECKOUT@@
      - uses: @@USES_PNPM@@
      - uses: @@USES_SETUP_NODE@@
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run guards

  gitleaks:
    runs-on: ubuntu-latest
    env:
      GITLEAKS_VERSION: "@@GITLEAKS_VERSION@@"
      GITLEAKS_SHA256: "@@GITLEAKS_SHA256@@"
    steps:
      - uses: @@USES_CHECKOUT@@
        with:
          fetch-depth: 0
      - name: Install gitleaks
        run: |
          file="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
          curl -sSfL -o "$file" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${file}"
          echo "${GITLEAKS_SHA256}  ${file}" | sha256sum -c -
          tar -xzf "$file" gitleaks
      - name: Scan history
        run: ./gitleaks git --redact --no-banner --config .gitleaks.toml -v

  signatures:
    runs-on: ubuntu-latest
    env:
      EVENT: ${{ github.event_name }}
      BEFORE: ${{ github.event.before }}
      SHA: ${{ github.sha }}
      BASE: ${{ github.base_ref }}
    steps:
      - uses: @@USES_CHECKOUT@@
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - name: Verify commit signatures
        run: |
          zero=0000000000000000000000000000000000000000
          if [ "$EVENT" = "pull_request" ]; then
            range="origin/$BASE..HEAD"
          elif [ "$BEFORE" != "$zero" ]; then
            range="$BEFORE..$SHA"
          else
            range="HEAD --not origin/main"
          fi
          sh scripts/verify-signatures.sh $range

  branch-name:
    runs-on: ubuntu-latest
    env:
      BRANCH: ${{ github.head_ref || github.ref_name }}
    steps:
      - uses: @@USES_CHECKOUT@@
      - name: Check the branch name
        run: node scripts/check-branch-name.mjs "$BRANCH"

  pr-notes:
    if: github.event_name == 'pull_request' && github.base_ref == 'main'
    runs-on: ubuntu-latest
    env:
      PR_BODY: ${{ github.event.pull_request.body }}
      REQUIRE_PR_BODY: "1"
    steps:
      - uses: @@USES_CHECKOUT@@
      - uses: @@USES_SETUP_NODE@@
        with:
          node-version-file: .nvmrc
      - name: Check the pull request notes
        run: node scripts/check-pr-notes.mjs

  ci-gate:
    if: always()
    needs: [lint, typecheck, build, test, guards, gitleaks, signatures, branch-name, pr-notes]
    runs-on: ubuntu-latest
    env:
      ANY_FAILED: ${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}
      LINT: ${{ needs.lint.result }}
      TYPECHECK: ${{ needs.typecheck.result }}
      BUILD: ${{ needs.build.result }}
      TEST: ${{ needs.test.result }}
      GUARDS: ${{ needs.guards.result }}
      GITLEAKS: ${{ needs.gitleaks.result }}
      SIGNATURES: ${{ needs.signatures.result }}
      BRANCH_NAME: ${{ needs.branch-name.result }}
      PR_NOTES: ${{ needs.pr-notes.result }}
    steps:
      - name: Summarise results
        run: |
          printf 'lint: %s\ntypecheck: %s\nbuild: %s\ntest: %s\nguards: %s\ngitleaks: %s\nsignatures: %s\nbranch-name: %s\npr-notes: %s\n' \
            "$LINT" "$TYPECHECK" "$BUILD" "$TEST" "$GUARDS" "$GITLEAKS" "$SIGNATURES" "$BRANCH_NAME" "$PR_NOTES"
          if [ "$ANY_FAILED" = "true" ]; then
            echo "At least one required job failed or was cancelled."
            exit 1
          fi
