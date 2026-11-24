# 0007 Custom Staff Roles and Audit Log

Status: accepted

Date: 2026-11-24

## Context

Medusa's RBAC and audit modules sit under an enterprise license with an online check. That conflicts with an offline break-glass account.

## Decision

Build staff roles, a deny-by-default permission manifest and an append-only audit table as custom modules. The roles are superadmin, catalog approver, order router, support and finance read-only. A database trigger keeps the audit table append-only. Force core TOTP multi-factor sign-in for staff and vendors. This is built in a later release.

## Consequences

The project owns the access code and its tests. Every admin route needs a manifest entry or a superadmin.

Undo cost: costly, because roles and audit rows become data that other features depend on.

## Alternatives Considered

- Medusa's enterprise RBAC and audit modules. Rejected because of the license and the online check.
- A single shared admin role. Rejected because it gives no separation of duties.
