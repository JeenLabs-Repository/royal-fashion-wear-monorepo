# Verify the Hosts

Fill this record on the app host and on the database host before the first deploy, and again after any change to either host. Run each command, write the observed result in the Result column and the date in the Date column. Write values only. Never paste a secret, a token or a password into this file.

Replace the placeholders with your own values.

- `<host-public-ip>` is the public address of the app host.
- `<db-public-ip>` is the public address of the database host, if it has one.
- `<db-private-ip>` is the private address of the database host.
- `$DATABASE_URL` is the connection string the backend uses.

## Checks on the App Host

| Check | Command | Expected | Result | Date |
|---|---|---|---|---|
| Dokploy version | `docker inspect --format '{{.Config.Image}}' $(docker ps -q -f name=dokploy)` and the version shown in the panel | 0.29.13 or later | | |
| Memory | `free -m \| awk '/^Mem:/ {print $2}'` | 7000 or more | | |
| CPU cores | `nproc` | 4 or more | | |
| Root disk | `df -BG / \| awk 'NR==2 {print $2}'` | 90G or more | | |
| Panel closed to the internet | `curl -sS --max-time 8 -o /dev/null -w '%{http_code}\n' http://<host-public-ip>:3000` from a machine outside the VPN | Times out or the connection is refused | | |
| Panel open inside the VPN | `curl -sS --max-time 8 -o /dev/null -w '%{http_code}\n' http://<host-private-or-vpn-ip>:3000` from inside the VPN | 200 or 302 | | |
| Firewall rules | `sudo ufw status numbered`, or the export from the provider firewall | Only ports 80 and 443 open to the world, panel and SSH limited to the VPN or allowlist | | |
| Redis not published | `ss -ltn \| grep -c ':6379'` | 0 | | |
| No build in the deployment | `docker compose -f deploy/docker-compose.yml config \| grep -c 'build:'` run with the environment values set | 0 | | |

## Checks on the Database

| Check | Command | Expected | Result | Date |
|---|---|---|---|---|
| Database port closed to the internet | `nc -vz -w 5 <db-public-ip> 5432` from a machine outside the private network | Fails with a timeout or refusal | | |
| Database port open from the app host | `nc -vz -w 5 <db-private-ip> 5432` from the app host | Succeeds | | |
| Database version | `psql "$DATABASE_URL" -tAc 'show server_version_num'` | A number whose first two digits are the major you pinned, for example 170002 for 17 | | |
| Postgres image pinned | `docker inspect --format '{{.Config.Image}}' <postgres-container>` on the database host | `postgres:<major>`, never `postgres:latest` | | |

## First Deploy

| Check | Command | Expected | Result | Date |
|---|---|---|---|---|
| Backend health | `curl -sS -o /dev/null -w '%{http_code}\n' https://<backend-domain>/health` | 200 | | |
| Bootstrap run twice | `docker exec <backend-container> sh -c 'cd /app/.medusa/server && /app/node_modules/.bin/medusa exec ./src/scripts/bootstrap-production.js'` | First run prints the created items, the Postgres major (equal to the pinned major) and the key token. The second run prints only `already present` lines. | | |
| First deploy log | Paste a short excerpt of the backend start log, with no secret values | Migrations ran and the server listens on port 9000 | | |

## Dokploy Clicks for Your Version

Write the exact clicks you used to create the application, attach the domains and set the environment, so the next person can repeat them.

1.
2.
3.
