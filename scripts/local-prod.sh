#!/bin/sh
# Production-like stack on the compute engine: the images are built locally and
# run through the production compose file plus a local override that adds a
# database and a mail catcher. Run it from any directory.
#
# Usage: sh scripts/local-prod.sh up | down | reset [--env]
#
#   up      generate throwaway secrets, build both images, start the stack, run
#           the first-deploy bootstrap twice inside the image (it must refuse
#           outside production and say "already present" the second time), check
#           that no demo data exists, and print a throwaway admin login once
#   up --demo-catalog
#           the same stack, but seed the starter's demo store and catalog instead
#           of running the bootstrap, so browser checks have products (test only)
#   down    stop the stack and keep its volumes
#   reset   stop the stack and remove its volumes (--env also deletes the
#           generated environment file)
set -eu

cd "$(dirname "$0")/.."

PROJECT=local-prod
ENV_FILE=deploy/.env.local-prod
COMPOSE="docker compose -p $PROJECT --env-file $ENV_FILE -f deploy/docker-compose.yml -f deploy/docker-compose.local-prod.yml"
SERVER_DIR=/app/.medusa/server
MEDUSA_BIN=/app/node_modules/.bin/medusa
DB_NAME=medusa_prod_like

usage() {
  echo "Usage: sh scripts/local-prod.sh up [--demo-catalog] | down | reset [--env]" >&2
  exit 2
}

write_env_file() {
  if [ -e "$ENV_FILE" ]; then
    echo "Keeping the existing $ENV_FILE (run reset --env to generate a new one)."
    return
  fi
  if ! git check-ignore -q "$ENV_FILE"; then
    echo "Refusing to write $ENV_FILE because git does not ignore it." >&2
    exit 1
  fi
  umask 077
  cat > "$ENV_FILE" <<ENV
BACKEND_IMAGE=medusa-backend:local
STOREFRONT_IMAGE=medusa-storefront:local
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)
INTEGRATION_ENCRYPTION_KEY=$(openssl rand -hex 32)
AUTH_MFA_ENCRYPTION_KEY=$(openssl rand -hex 32)
REVALIDATE_SECRET=$(openssl rand -hex 32)
DATABASE_URL=postgres://postgres:postgres@postgres:5432/$DB_NAME
STORE_CORS=http://localhost:18000
ADMIN_CORS=http://localhost:19000
AUTH_CORS=http://localhost:18000,http://localhost:19000
STOREFRONT_URL=http://storefront:8000
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=store@example.test
ENV
  echo "Wrote $ENV_FILE with generated throwaway secrets."
}

in_backend() {
  $COMPOSE exec -T backend sh -c "cd $SERVER_DIR && $1"
}

# Proves both routes to the backend. The browser uses the address baked into the
# storefront image (published on localhost); the storefront server uses the
# separate server-only address on the Compose network.
check_browser_path() {
  key=$1

  server_url=$($COMPOSE exec -T storefront printenv MEDUSA_BACKEND_URL | tr -d '[:space:]')
  if [ "$server_url" != "http://backend:9000" ]; then
    echo "Storefront container MEDUSA_BACKEND_URL is '$server_url', expected http://backend:9000." >&2
    exit 1
  fi

  page_status=$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:18000/en)
  if [ "$page_status" != "200" ]; then
    echo "Storefront page returned $page_status; the server-side backend call may be failing." >&2
    exit 1
  fi

  headers=$(curl -sS -D - -o /dev/null \
    -H "Origin: http://localhost:18000" -H "x-publishable-api-key: $key" \
    "http://localhost:19000/store/regions?limit=1")
  if ! printf '%s' "$headers" | head -n 1 | grep -q ' 200'; then
    echo "Backend is not reachable from the host at http://localhost:19000." >&2
    exit 1
  fi
  if ! printf '%s' "$headers" | grep -qi '^access-control-allow-origin: http://localhost:18000'; then
    echo "Backend does not allow the storefront origin http://localhost:18000 (check STORE_CORS)." >&2
    exit 1
  fi

  if curl -sS http://localhost:18000/en | grep -q 'backend:9000'; then
    echo "The served page points the browser at the container name backend:9000." >&2
    exit 1
  fi

  echo "Browser path OK"
}

up() {
  demo_catalog=0
  if [ "${1:-}" = "--demo-catalog" ]; then
    demo_catalog=1
  fi

  write_env_file

  echo "Building the backend image."
  docker build -f apps/backend/Dockerfile -t medusa-backend:local .

  echo "Starting the database, Redis and the backend."
  $COMPOSE up -d --wait --wait-timeout 300 postgres redis backend

  demo_products=$($COMPOSE exec -T postgres psql -U postgres -d "$DB_NAME" -tAc \
    "select count(*) from product where deleted_at is null" | tr -d '[:space:]')
  echo "Demo products after migrate: $demo_products"
  if [ "$demo_products" != "0" ]; then
    echo "A production-mode migrate on an empty database created products. Stop and gate the seed." >&2
    exit 1
  fi

  if [ "$demo_catalog" = "1" ]; then
    echo "Seeding the demo store and catalog. This is for browser checks on this test stack only."
    in_backend "ALLOW_DEMO_SEED=1 $MEDUSA_BIN exec ./src/migration-scripts/initial-data-seed.js"
  else
    echo "Proving the bootstrap refuses to run outside production."
    if in_backend "NODE_ENV=development $MEDUSA_BIN exec ./src/scripts/bootstrap-production.js" >/dev/null 2>&1; then
      echo "The bootstrap ran with NODE_ENV=development and no flag. It must refuse." >&2
      exit 1
    fi

    echo "Running the first-deploy bootstrap."
    first_run=$(in_backend "$MEDUSA_BIN exec ./src/scripts/bootstrap-production.js")
    printf '%s\n' "$first_run"
    second_run=$(in_backend "$MEDUSA_BIN exec ./src/scripts/bootstrap-production.js")
    if ! printf '%s\n' "$second_run" | grep -q 'already present'; then
      echo "The second bootstrap run did not report already present." >&2
      exit 1
    fi
    if printf '%s\n' "$second_run" | grep -q '\[bootstrap\] created'; then
      echo "The second bootstrap run created something. It must be safe to run twice." >&2
      exit 1
    fi

    for table in product product_category stock_location; do
      count=$($COMPOSE exec -T postgres psql -U postgres -d "$DB_NAME" -tAc \
        "select count(*) from $table where deleted_at is null" | tr -d '[:space:]')
      echo "Rows in $table after bootstrap: $count"
      if [ "$count" != "0" ]; then
        echo "The bootstrap created rows in $table. It must create none." >&2
        exit 1
      fi
    done
    demo_products=$($COMPOSE exec -T postgres psql -U postgres -d "$DB_NAME" -tAc \
      "select count(*) from product where deleted_at is null" | tr -d '[:space:]')
    echo "Demo products after bootstrap: $demo_products"
    users=$($COMPOSE exec -T postgres psql -U postgres -d "$DB_NAME" -tAc \
      "select count(*) from \"user\" where deleted_at is null" | tr -d '[:space:]')
    echo "Users after bootstrap: $users"
    if [ "$users" != "0" ]; then
      echo "The bootstrap created a user. It must create none." >&2
      exit 1
    fi
  fi

  db_version_num=$($COMPOSE exec -T postgres psql -U postgres -d "$DB_NAME" -tAc \
    "show server_version_num" | tr -d '[:space:]')
  echo "Postgres major: $((db_version_num / 10000))"

  publishable_key=$($COMPOSE exec -T postgres psql -U postgres -d "$DB_NAME" -tAc \
    "select token from api_key where type = 'publishable' and deleted_at is null limit 1" | tr -d '[:space:]')
  if [ -z "$publishable_key" ]; then
    echo "No publishable API key found after seeding." >&2
    exit 1
  fi

  echo "Building the storefront image with the publishable key."
  docker build -f apps/storefront/Dockerfile \
    --build-arg NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY="$publishable_key" \
    --build-arg NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:19000 \
    --build-arg NEXT_PUBLIC_BASE_URL=http://localhost:18000 \
    --build-arg NEXT_PUBLIC_DEFAULT_REGION=in \
    --build-arg NEXT_PUBLIC_SITE_NAME=Store \
    -t medusa-storefront:local .

  echo "Starting the storefront and the mail catcher."
  $COMPOSE up -d --wait --wait-timeout 300 storefront mailpit

  check_browser_path "$publishable_key"

  admin_email="prodlike-admin-$(openssl rand -hex 4)@example.test"
  admin_password=$(openssl rand -hex 12)
  $COMPOSE exec -T -e ADMIN_EMAIL="$admin_email" -e ADMIN_PASSWORD="$admin_password" backend \
    sh -c "cd $SERVER_DIR && $MEDUSA_BIN user -e \"\$ADMIN_EMAIL\" -p \"\$ADMIN_PASSWORD\""

  $COMPOSE ps
  echo ""
  echo "Storefront:  http://localhost:18000"
  echo "Admin:       http://localhost:19000/app"
  echo "Mail:        http://localhost:8025"
  echo "Admin email: $admin_email"
  echo "Admin password (shown once, not stored): $admin_password"
  echo "Delete this account when the test is done (reset removes the whole database)."
}

down() {
  if [ -e "$ENV_FILE" ]; then
    $COMPOSE down
  else
    docker compose -p "$PROJECT" down
  fi
}

reset() {
  if [ -e "$ENV_FILE" ]; then
    $COMPOSE down -v --remove-orphans
  else
    docker compose -p "$PROJECT" down -v --remove-orphans
  fi
  if [ "${1:-}" = "--env" ]; then
    rm -f "$ENV_FILE"
    echo "Removed $ENV_FILE."
  fi
}

case "${1:-}" in
  up) up "${2:-}" ;;
  down) down ;;
  reset) reset "${2:-}" ;;
  *) usage ;;
esac
