# 0002 Dokploy on the Owner Server

Status: accepted

Date: 2026-11-24

## Context

Research recommended Docker Compose with Caddy. The owner chose Dokploy. The host has 4 cores, 8 GB RAM and 100 GB storage, and also runs the backend, the storefront and Redis. Dokploy adds memory overhead and had security advisories in 2026.

## Decision

Use Dokploy on the owner server under these conditions.

- The host has at least 4 GB of RAM. The current host has 8 GB.
- The panel is reachable only from a VPN or an IP allowlist and never on a public port.
- The version is 0.29.13 or later.
- Images are built in CI. The server never builds.
- Secrets live in Dokploy's environment settings, with a sealed offline copy.

## Consequences

The conditions above are part of every host check. A breached or unpatched panel controls every app on the host.

Undo cost: costly, because deployments, secrets and routing move to a new tool.

## Alternatives Considered

- Docker Compose with Caddy. Lighter, and the research default, but the owner prefers the panel.
- A managed platform. Rejected because the project is self-hosted by choice.
