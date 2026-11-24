# 0004 Database on a Separate Private Host

Status: accepted

Date: 2026-11-24

## Context

The owner operates a separate database host and runs its backups. The app host has limited memory.

## Decision

Run Postgres on the owner-operated host. Reach it over a private network or VPN and never expose it to the internet. The app host has no Postgres container in production. Pin the host to the numeric Postgres major it runs and never to the `latest` tag, because a silent major upgrade breaks the data directory; plan a dump and restore for any future major upgrade. Keep that major as one variable (`POSTGRES_VERSION`, fallback 17 until the real major is known) in the dev compose file and in CI service containers. TLS on the private link is optional through `DATABASE_SSL`, and the owner decides.

## Consequences

The owner is responsible for backups and the private link. The app cannot start if that link is down.

Undo cost: costly, because moving the database needs a dump, a restore and a cutover.

## Alternatives Considered

- Postgres container on the app host. Rejected because of memory use and backup ownership.
- A managed database. Rejected because the owner prefers to operate it.
