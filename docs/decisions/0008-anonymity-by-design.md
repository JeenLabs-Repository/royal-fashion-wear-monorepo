# 0008 Anonymity by Design

Status: accepted

Date: 2026-11-24

## Context

Customers must never learn which vendor supplies a product. A single leak breaks the business model.

## Decision

Customers see only the ship-from state. Vendor data is never linked to commerce models by module links. Every customer-facing and vendor response goes through an allowlist serializer. A guard on store routes rejects forbidden `fields` and `expand` terms. Locations get opaque names. Images are re-encoded and stored under random keys. A canary test seeds distinctive vendor strings and fails if any appear in customer-facing output. This is built across later releases.

## Consequences

Features that would show vendor details are not built. Every new customer-facing surface extends the canary test.

Undo cost: one-way once data exists, because leaked identifiers cannot be recalled.

## Alternatives Considered

- Show a vendor display name. Rejected because it breaks the core promise.
- Rely on code review alone. Rejected because a single missed field leaks identity.
