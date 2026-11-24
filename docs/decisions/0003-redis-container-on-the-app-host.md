# 0003 Redis Container on the App Host

Status: accepted

Date: 2026-11-24

## Context

Without Redis, Medusa keeps sessions, events and workflows in memory and loses them on every restart.

## Decision

Keep Redis. Run it as a container on the app host with append-only persistence on, the `noeviction` policy and a small memory cap of 64 MB. Reach it only on the internal Docker network and publish no port.

## Consequences

Sessions and queued work survive a restart. A full cache returns errors instead of silently dropping keys, so watch memory use.

Undo cost: reversible, because Redis holds recoverable state and the container can be replaced.

## Alternatives Considered

- In-memory fallback. Rejected because restarts lose sessions and workflow state.
- A managed Redis service. Rejected because it adds a service and a network path.
