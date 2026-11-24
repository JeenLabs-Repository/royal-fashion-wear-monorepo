#!/bin/sh
# Runs every automated baseline check and prints one labelled line per topic.
# It keeps going after a failure and exits 1 at the end if any topic failed.
#
# Usage: sh scripts/verify-baseline.sh [--with-integration] [--with-images] [--with-e2e]
#
#   --with-integration  also run the HTTP integration tests (needs Docker for the
#                       development Postgres)
#   --with-images       also build both images and run the boot and Node proofs
#                       (needs Docker)
#   --with-e2e          also run every Playwright spec (needs a running stack)
#
# Run it from the repository root on the compute engine.
set -u

cd "$(dirname "$0")/.."

with_integration=0
with_images=0
with_e2e=0
for arg in "$@"; do
  case "$arg" in
    --with-integration) with_integration=1 ;;
    --with-images) with_images=1 ;;
    --with-e2e) with_e2e=1 ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: sh scripts/verify-baseline.sh [--with-integration] [--with-images] [--with-e2e]" >&2
      exit 2
      ;;
  esac
done

failures=0
BASE_REF=${BASE_REF:-main}
PLACEHOLDER_KEY=${NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY:-pk_build_placeholder}

# run_topic <name> <function>: runs the function, prints one line, records a failure.
run_topic() {
  name=$1
  fn=$2
  if output=$("$fn" 2>&1); then
    echo "[PASS] $name"
  else
    echo "[FAIL] $name"
    first=$(printf '%s\n' "$output" | grep -iE 'fail|error|refus|missing|not found|expected' | head -n 1)
    [ -n "$first" ] || first=$(printf '%s\n' "$output" | tail -n 1)
    echo "       $first"
    failures=$((failures + 1))
  fi
}

count_files() {
  ls "$1" | wc -l | tr -d '[:space:]'
}

t_install() {
  pnpm install --frozen-lockfile
}

t_guards() {
  pnpm run guards
}

t_commit_rules() {
  node scripts/check-commit-rules.mjs
}

t_gitleaks_selftest() {
  sh scripts/check-gitleaks-hook.sh
}

t_lint_backend() {
  pnpm -C apps/backend run lint
}

t_lint_storefront() {
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=$PLACEHOLDER_KEY pnpm -C apps/storefront run lint
}

t_typecheck_backend() {
  pnpm -C apps/backend exec tsc --noEmit
}

t_typecheck_storefront() {
  pnpm -C apps/storefront exec tsc --noEmit
}

t_build_backend() {
  pnpm -C apps/backend run build
}

t_build_storefront() {
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=$PLACEHOLDER_KEY pnpm -C apps/storefront run build
}

t_unit_tests() {
  pnpm -C apps/backend run test:unit
}

t_pins() {
  node scripts/check-pins.mjs || return 1
  [ "$(grep -c '"latest"' apps/backend/package.json)" = "0" ] || { echo "error: a latest tag is in apps/backend/package.json"; return 1; }
}

t_node_version() {
  [ "$(head -n 1 .nvmrc)" = "22.23.4" ] || { echo "error: .nvmrc is not 22.23.4"; return 1; }
  node -e "const [a,b,c]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&(b>23||(b===23&&c>=4)))?0:1)" || { echo "error: this machine runs Node $(node -v)"; return 1; }
  node scripts/check-dockerfiles.mjs
}

t_geolocation_removed() {
  hits=$(grep -rliE 'geolocation|ip-api|x-geo-' apps/storefront --include=*.ts --include=*.tsx --include=*.js --include=*.template --exclude-dir=node_modules --exclude-dir=.next | wc -l | tr -d '[:space:]')
  [ "$hits" = "0" ] || { echo "error: $hits storefront files still mention country detection"; return 1; }
}

t_dadata_removed() {
  hits=$(grep -rli dadata apps/storefront --include=*.ts --include=*.tsx --include=*.json --include=*.template --exclude-dir=node_modules --exclude-dir=.next | wc -l | tr -d '[:space:]')
  [ "$hits" = "0" ] || { echo "error: $hits storefront files still mention the removed address provider"; return 1; }
}

t_regions_count() {
  [ "$(count_files apps/backend/src/migration-scripts/data/regions/json)" = "1" ] || { echo "error: seed regions are not exactly one"; return 1; }
}

t_seed_locales_count() {
  [ "$(count_files apps/backend/src/migration-scripts/data/i18n/json)" = "1" ] || { echo "error: seed locales are not exactly one"; return 1; }
}

t_email_catalogs_count() {
  [ "$(count_files apps/backend/src/emails/i18n/messages)" = "1" ] || { echo "error: email catalogs are not exactly one"; return 1; }
}

t_storefront_catalogs_count() {
  [ "$(count_files apps/storefront/messages)" = "1" ] || { echo "error: storefront catalogs are not exactly one"; return 1; }
}

t_flags_count() {
  [ "$(ls apps/storefront/public/flags/4x3)" = "in.svg" ] || { echo "error: the flags folder is not only in.svg"; return 1; }
}

t_rtl_removed() {
  hits=$(grep -rnE 'rtl:|useLocaleDirection|isRtl|getLocaleDir|rtlLocales|LocaleDirection|HtmlDirSync|RTL_LOCALES|\bdir=\{' apps/storefront/src apps/backend/src/emails --include=*.ts --include=*.tsx | grep -v '/messages/' | wc -l | tr -d '[:space:]')
  [ "$hits" = "0" ] || { echo "error: $hits right-to-left leftovers"; return 1; }
}

t_stub_routes_removed() {
  [ ! -e apps/backend/src/api/store/custom/route.ts ] || { echo "error: store stub route exists"; return 1; }
  [ ! -e apps/backend/src/api/admin/custom/route.ts ] || { echo "error: admin stub route exists"; return 1; }
}

t_telemetry_config() {
  grep -q 'GORGO_DISABLE_TELEMETRY=true' apps/backend/.env.template || { echo "error: backend template lacks the telemetry switch"; return 1; }
  grep -q 'GORGO_DISABLE_TELEMETRY=true' deploy/.env.production.template || { echo "error: production template lacks the telemetry switch"; return 1; }
  grep -q 'GORGO_DISABLE_TELEMETRY: "true"' deploy/docker-compose.yml || { echo "error: compose file lacks the telemetry switch"; return 1; }
  grep -q 'GORGO_DISABLE_TELEMETRY=true' apps/backend/Dockerfile || { echo "error: backend Dockerfile lacks the telemetry switch"; return 1; }
}

t_signatures() {
  STRICT=1 sh scripts/verify-signatures.sh "$BASE_REF..HEAD"
}

t_ignore_rules() {
  git check-ignore -q TEST-CREDENTIALS.local.md || { echo "error: the credentials file is not ignored"; return 1; }
  git check-ignore -q apps/backend/.env || { echo "error: apps/backend/.env is not ignored"; return 1; }
  git check-ignore -q deploy/.env.local-prod || { echo "error: deploy/.env.local-prod is not ignored"; return 1; }
  git check-ignore -q apps/backend/.env.template && { echo "error: a template file is ignored"; return 1; }
  git check-ignore -q deploy/.env.production.template && { echo "error: the production template is ignored"; return 1; }
  return 0
}

t_docs_structure() {
  [ "$(ls docs/decisions/0*.md | wc -l | tr -d '[:space:]')" = "12" ] || { echo "error: docs/decisions does not hold 12 numbered files"; return 1; }
  for guide in getting-started backend-configuration localization release commit-workflow repository-setup deploy-dokploy host-verification-record release-checklist; do
    [ -f "docs/guides/$guide.md" ] || { echo "error: docs/guides/$guide.md is missing"; return 1; }
  done
}

t_docs_consistent() {
  [ "$(node scripts/check-doc-consistency.mjs --count)" = "0" ] || { echo "error: the docs hold a stale statement"; return 1; }
}

t_integration_tests() {
  docker compose -f docker-compose.dev.yml up -d --wait || return 1
  DB_HOST=localhost DB_USERNAME=postgres DB_PASSWORD=postgres pnpm -C apps/backend run test:integration:http
}

t_image_backend_build() {
  docker build -f apps/backend/Dockerfile -t medusa-backend:local .
}

t_image_storefront_build() {
  docker build -f apps/storefront/Dockerfile \
    --build-arg NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY="$PLACEHOLDER_KEY" \
    --build-arg NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000 \
    --build-arg NEXT_PUBLIC_BASE_URL=http://localhost:8000 \
    -t medusa-storefront:local .
}

t_image_node_version() {
  [ "$(docker run --rm medusa-backend:local node -v)" = "v22.23.4" ] || { echo "error: the backend image does not run Node 22.23.4"; return 1; }
  [ "$(docker run --rm medusa-storefront:local node -v)" = "v22.23.4" ] || { echo "error: the storefront image does not run Node 22.23.4"; return 1; }
}

t_image_boot_refusal() {
  if out=$(docker run --rm medusa-backend:local 2>&1); then
    echo "error: the backend image started without secrets"
    return 1
  fi
  printf '%s\n' "$out" | grep -q 'Refusing to start in production' || { echo "error: no refusal message in the output"; return 1; }
}

t_image_telemetry() {
  [ "$(docker run --rm medusa-backend:local sh -c 'echo $GORGO_DISABLE_TELEMETRY')" = "true" ] || { echo "error: telemetry is not off in the backend image"; return 1; }
}

t_node20_install_fails() {
  # Isolated install surface so a root-owned Docker write never touches the
  # workspace. pnpm 12 needs --config.engine-strict=true; .npmrc alone is not
  # enough for this major.
  tmp=$(mktemp -d) || { echo "error: could not create a temp directory"; return 1; }
  cleanup_tmp() {
    docker run --rm -v "$tmp":/w alpine sh -c 'rm -rf /w/* /w/.[!.]* /w/..?*' >/dev/null 2>&1 || true
    rm -rf "$tmp"
  }
  mkdir -p "$tmp/apps/backend" "$tmp/apps/storefront" || {
    cleanup_tmp
    echo "error: could not prepare the temp tree"
    return 1
  }
  cp package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc "$tmp/" || {
    cleanup_tmp
    echo "error: could not copy the install surface"
    return 1
  }
  cp apps/backend/package.json "$tmp/apps/backend/" || {
    cleanup_tmp
    echo "error: could not copy the backend package manifest"
    return 1
  }
  cp apps/storefront/package.json "$tmp/apps/storefront/" || {
    cleanup_tmp
    echo "error: could not copy the storefront package manifest"
    return 1
  }
  out=$(
    docker run --rm -v "$tmp":/w -w /w node:20 \
      sh -c 'corepack enable && corepack prepare pnpm@12.18.0 --activate && pnpm install --frozen-lockfile --config.engine-strict=true' \
      2>&1
  ) || {
    printf '%s\n' "$out" | grep -qiE 'unsupported.?engine|ERR_PNPM_UNSUPPORTED_ENGINE' || {
      cleanup_tmp
      echo "error: Node 20 install failed for a reason other than engines"
      printf '%s\n' "$out" | tail -n 5
      return 1
    }
    cleanup_tmp
    return 0
  }
  cleanup_tmp
  echo "error: an install under Node 20 succeeded"
  return 1
}

t_e2e_specs() {
  pnpm e2e
}

run_topic install t_install
run_topic guards t_guards
run_topic commit-rules t_commit_rules
run_topic gitleaks-selftest t_gitleaks_selftest
run_topic lint-backend t_lint_backend
run_topic lint-storefront t_lint_storefront
run_topic typecheck-backend t_typecheck_backend
run_topic typecheck-storefront t_typecheck_storefront
run_topic build-backend t_build_backend
run_topic build-storefront t_build_storefront
run_topic unit-tests t_unit_tests
run_topic pins t_pins
run_topic node-version t_node_version
run_topic geolocation-removed t_geolocation_removed
run_topic dadata-removed t_dadata_removed
run_topic locale-count-regions t_regions_count
run_topic locale-count-seed-locales t_seed_locales_count
run_topic locale-count-email-catalogs t_email_catalogs_count
run_topic locale-count-storefront-catalogs t_storefront_catalogs_count
run_topic locale-count-flags t_flags_count
run_topic rtl-removed t_rtl_removed
run_topic stub-routes-removed t_stub_routes_removed
run_topic telemetry-config t_telemetry_config
run_topic signatures t_signatures
run_topic ignore-rules t_ignore_rules
run_topic docs-structure t_docs_structure
run_topic docs-consistent t_docs_consistent

if [ "$with_integration" = "1" ]; then
  run_topic integration-tests t_integration_tests
fi

if [ "$with_images" = "1" ]; then
  run_topic image-backend-build t_image_backend_build
  run_topic image-storefront-build t_image_storefront_build
  run_topic image-node-version t_image_node_version
  run_topic image-boot-refusal t_image_boot_refusal
  run_topic image-telemetry t_image_telemetry
  run_topic node20-install-fails t_node20_install_fails
fi

if [ "$with_e2e" = "1" ]; then
  run_topic e2e-specs t_e2e_specs
fi

if [ "$failures" -gt 0 ]; then
  echo "[FAIL] $failures topic(s) failed"
  exit 1
fi
exit 0
