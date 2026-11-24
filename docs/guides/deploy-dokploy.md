# Deploy With Dokploy

This guide takes you from a signed release tag to a running stack on the app host. CI builds the images, and the app host only pulls and runs them. You never build on the live server.

## Topology Has Two Hosts

The stack uses two hosts and nothing else.

- **App host.** Runs Dokploy, the backend, the storefront and Redis. It has 4 cores, 8 GB of RAM and 100 GB of storage.
- **Database host.** Runs Postgres. You operate it, you run its backups, and the app host reaches it over a private network or VPN. It is never reachable from the internet.

The production compose file at `deploy/docker-compose.yml` holds the backend, the storefront and Redis. It starts no database and publishes no port. Dokploy attaches the domains and its proxy network.

Decision records `0001`, `0002`, `0003` and `0004` in `docs/decisions/` explain why the stack looks like this.

## Host Requirements and Posture

Check the app host against this list before the first deploy. The host verification record in [host-verification-record.md](host-verification-record.md) holds the commands and the expected results.

- Dokploy 0.29.13 or later. Patch it on a routine and after every security advisory.
- At least 4 GB of RAM for Dokploy, the backend, the storefront and Redis together. This host has 8 GB.
- The Dokploy panel is reachable only from the VPN or an allowlist and never on a public port. The panel controls the Docker socket, so a public panel means host takeover.
- A firewall that drops everything except the ports you open on purpose. An example with `ufw`, where `<vpn-subnet>` is your VPN range and `<admin-ip>` is a fixed address you trust.

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from <vpn-subnet> to any port 22 proto tcp
sudo ufw allow from <vpn-subnet> to any port 3000 proto tcp
sudo ufw enable
sudo ufw status numbered
```

Docker publishes container ports around `ufw`. This is why the compose file publishes none, and why the panel must also listen only on the VPN address or sit behind your provider's firewall.

## Registry Access Uses a Read Token

The images live in a private GitHub container registry. The app host needs a token to pull them.

1. In GitHub, open Settings, Developer settings, Personal access tokens and create a token with only the `read:packages` scope.
2. In Dokploy, open Settings, Registry and add a registry with the host `ghcr.io`, your GitHub user name and the token.
3. Store the token in the sealed offline copy of your secrets. Revoke and replace it after any exposure.

## Image Build Variables Are Public

Next.js bakes every `NEXT_PUBLIC_` value into the storefront image at build time, so the images workflow reads them from GitHub Actions variables. Set these four under Settings, Secrets and variables, Actions, Variables before you push a release tag. The workflow stops with a message that names any variable you left empty.

- `NEXT_PUBLIC_MEDUSA_BACKEND_URL` is the public https address of the backend, reachable from a browser. Do not put a container name here.
- `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` is the publishable API key from the Admin. A publishable key is public by design.
- `NEXT_PUBLIC_BASE_URL` is the public https address of the storefront.
- `NEXT_PUBLIC_SITE_NAME` is the store name shown in the header.

Never put a secret in a variable with this prefix. The Postgres major for CI is the optional `POSTGRES_VERSION` variable. It defaults to 17 until you set it to the major your database host runs.

## Environment and Secrets Live in Dokploy

Production secrets live in Dokploy's environment tab. They never go in the repository, in CI or in logs.

The file `deploy/.env.production.template` lists every key with a placeholder. Generate each secret on a trusted machine.

```sh
openssl rand -hex 32
```

Rules for the key set.

- Every secret needs at least 32 characters. The backend refuses to start with an unset, placeholder or short value.
- Set `JWT_SECRET`, `COOKIE_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `AUTH_MFA_ENCRYPTION_KEY` and `REVALIDATE_SECRET` to different values.
- Back up `INTEGRATION_ENCRYPTION_KEY` with the database backups. Losing it makes stored integration secrets unreadable.
- Keep a sealed offline copy of the whole key set. Rotate any key after an exposure.
- Escape a dollar sign in a value as `$$`, because Compose reads a single dollar sign as a variable.
- Keep `GORGO_DISABLE_TELEMETRY=true` and `MEDUSA_DISABLE_TELEMETRY=true`.
- Later releases read `TRUST_PROXY_HOPS`, the number of reverse proxies in front of the backend. Dokploy's Traefik is the only hop, so the value is 1. If you ever put a CDN or a load balancer in front of Traefik, raise it to match, because a wrong number makes the backend record the proxy's address instead of the visitor's.

`backend-configuration.md` in this folder explains what the production boot check rejects.

## Database Host Accepts the App Host Only

Configure the database host once and check it again after any network change.

- Allow connections to the database port only from the app host's private address. Block the port from the internet.
- Run the Postgres image pinned to the major the host really runs, and never to `latest`. The next section shows how to read and pin it. The major is one variable in the dev stack and in CI, so keeping them equal is small.
- Put the private address in `DATABASE_URL`. If you want TLS on the private link, set `DATABASE_SSL=true`.
- You run the backups. Back up before every deploy that includes migrations, and keep migrations backwards compatible so a rollback does not need a restore.

## Pin Postgres On The Database Host

The database runs in Docker on the database host. Never run it from the `latest` tag. The next pull of `latest` can bring a new major version, and a new major version cannot open a data directory that an older one wrote, so the database would refuse to start after a restart or a redeploy.

1. Read the version in use. Run these against the production database from a machine that can reach it.

   ```sh
   psql "$DATABASE_URL" -tAc 'select version();'
   psql "$DATABASE_URL" -tAc 'show server_version_num;'
   ```

   The first prints text such as `PostgreSQL 17.2 on x86_64-pc-linux-gnu`. The second prints a number such as `170002`, and its first two digits are the major. If you cannot reach the database from your machine, run `docker exec <postgres-container> postgres --version` on the database host instead (the container you started from `latest` reports the major it runs).
2. Pin the same major tag in the host's compose file or run command. Use the major you just read, not a guess. In a compose file the line reads `image: postgres:<major>`. In a run command the image argument reads `postgres:<major>`.
3. Back up the database, recreate the container so the pinned tag is the one that runs, and check it.

   ```sh
   docker inspect --format '{{.Config.Image}}' <postgres-container>
   ```

   Expect `postgres:<major>` and never `postgres:latest`.
4. Set the repository variable `POSTGRES_VERSION` to the same major. Use the same value for the dev stack, so development and CI test against the major that production runs. Until you set it, both default to 17.
5. Plan any future major upgrade as a dump and restore. Take a full dump from the old container. Start a new container on the new major with an empty data directory. Restore the dump into it, run the application against it, and only then switch the connection string. Never change the tag in place.

## Create the Application in Dokploy

1. Create a project, then a Compose application of the raw type.
2. Paste the content of `deploy/docker-compose.yml`.
3. Open the environment tab and paste the values from your sealed copy. Set `BACKEND_IMAGE` and `STOREFRONT_IMAGE` to the release tag you are deploying.
4. Add one domain for the storefront that points at the `storefront` service on port 8000, and one for the backend and Admin that points at the `backend` service on port 9000. Dokploy attaches its proxy network to those services.
5. Deploy.

Dokploy's screens change between versions. Write the exact clicks of your version into the verification record the first time you do this.

## Run the First Deploy Bootstrap

A real first deploy needs a store, an India region, a sales channel and a publishable key, and nothing else. A one-time script creates exactly those. It never creates products, categories, users or a stock location, and the starter's demo data never runs in production.

The order is always the same. The backend container migrates the database when it starts. Then you run the bootstrap once. Then you copy the key it prints.

1. Deploy the backend with `RUN_MIGRATIONS=true` and wait for it to be healthy.
2. Run the bootstrap once inside the backend container.

   ```sh
   docker exec <backend-container> sh -c 'cd /app/.medusa/server && /app/node_modules/.bin/medusa exec ./src/scripts/bootstrap-production.js'
   ```

   Expect `[bootstrap] created` lines for the sales channel, the store settings, the India region, the tax region, tax-inclusive pricing and the publishable key. Then expect a `Postgres major:` line, a `Publishable key id:` line and a `Publishable key token:` line.
3. Check that the Postgres major it printed equals the major you pinned on the database host. If it does not, stop and fix the pin before anything else.
4. Copy the key token into the `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` repository variable, rebuild the storefront image through the images workflow, and deploy it. A publishable key is public by design.
5. Run the command again. Expect `[bootstrap] already present` lines only, the same key and no `created` line. The script is safe to run twice.

The script refuses to run unless the container has `NODE_ENV=production`. On a throwaway database you can pass `--allow-non-production` after the script path instead, or set `BOOTSTRAP_ALLOW_NON_PRODUCTION=1`.

## First Deploy Checks

Run these on the app host after the first deploy.

```sh
docker compose ls
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -sS -o /dev/null -w '%{http_code}\n' https://<backend-domain>/health
```

Expect the health request to print `200`. The `Ports` column must show no host port for Redis, the backend or the storefront. The bootstrap output printed the Postgres major, and it must equal the major you pinned on the database host.

Prove that a missing secret stops the deploy. Remove `JWT_SECRET` from the environment tab in a throwaway copy of the application and deploy it. Expect Compose to refuse with a message that names `JWT_SECRET`. Then confirm Redis is not published.

```sh
ss -ltn | grep -c ':6379'
```

Expect `0`.

## Update and Roll Back by Changing the Tag

1. Merge to `main` through the pull request routine in [release.md](release.md).
2. Create and publish the signed tag. The images workflow builds both images only for a tag whose signature verifies.
3. In Dokploy, set `BACKEND_IMAGE` and `STOREFRONT_IMAGE` to the new tag and redeploy.
4. To roll back, set both variables to the previous tag and redeploy.

Back up the database before any release that includes migrations.

## Production-Like Test

Run this on your compute engine, never on the live server. It builds both images locally and runs them through the production compose file with a local database and a mail catcher. It needs Docker and at least 6 GB available to containers.

```sh
sh scripts/local-prod.sh up
```

The storefront image is built with `NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:19000`, the address your browser can reach. The storefront container also gets a separate server-only `MEDUSA_BACKEND_URL=http://backend:9000`, which its server-side calls use on the Compose network. The script checks both routes and prints `Browser path OK`. It also counts products right after the migration on the empty database and prints `Demo products after migrate: 0`; a different number stops the script, because a production-mode migrate must not create demo data. The script then proves the first-deploy path inside the production image. It checks that the bootstrap refuses to run with `NODE_ENV=development`, runs the bootstrap twice, expects `already present` the second time, and counts products, categories, stock locations and users, which must all be `0`. It prints the Postgres major of the test database. To browse a catalog, reset the stack and run `sh scripts/local-prod.sh up --demo-catalog`, which seeds the starter's demo store and products on this test stack only and skips the bootstrap proof.

Expect the output to end with the storefront and Admin addresses and a throwaway admin login that is shown once. Then run the browser specs against the stack.

```sh
E2E_STOREFRONT_URL=http://localhost:18000 E2E_BACKEND_URL=http://localhost:19000 pnpm e2e -- storefront-boots storefront-english-only
```

Check the stack by hand. On the plain stack the storefront loads with an empty catalog, and the Admin shows one region (India, INR) and no products. For the product and cart check, reset the stack, run it again with `sh scripts/local-prod.sh up --demo-catalog`, open the storefront at `http://localhost:18000`, open a product, add it to the cart, and sign in to the Admin at `http://localhost:19000/app` with the throwaway login.

Prove that sessions survive a backend restart.

```sh
ADMIN_EMAIL=<printed email> ADMIN_PASSWORD=<printed password> sh scripts/verify-session-survives-restart.sh
```

Expect the last line to be `SESSION_SURVIVED`. Remove the stack and its data when you finish.

```sh
sh scripts/local-prod.sh reset
```

Use separate accounts for this test and delete them afterwards. Never use the development demo accounts here. Keep Razorpay in test mode until one final small live payment.

## Not Covered Yet

This release is for private checks and is not opened to customers. These items come later.

- Rate limits and an allowlist at the reverse proxy for the admin paths.
- Container memory limits, which you set from measurements of the running stack.
- A rehearsal of restoring from backup.
- The default system payment provider is still enabled in the region, so a real checkout is not safe yet.
