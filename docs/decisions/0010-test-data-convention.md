# 0010 Test Data Convention

Status: accepted

Date: 2026-11-24

## Context

Testing needs accounts, addresses, orders and settings values. Real data and production secrets must never enter tests or git.

## Decision

The AI creates every field value needed for testing with obviously fake data. That includes addresses with valid state and PIN pairs, accounts per role, orders and settings values. It records all of it in the untracked `TEST-CREDENTIALS.local.md`, which is ignored before it exists. A seed script writes the baseline. Values that cannot be invented, such as Razorpay test keys and real SMTP credentials, are listed as owner to provide. Dev mail goes to a local catcher. Dev credentials are never used in production. The production-build test uses separate accounts that are deleted afterwards.

## Consequences

The owner can read and reuse the file for manual testing. A pre-commit hook and a CI scan block the file even when it is force-added.

Undo cost: reversible, because the file and seed script are plain files.

## Alternatives Considered

- Hand-written test data in each spec. Rejected because the owner cannot review it in one place.
- Real or copied production data. Rejected because of privacy and security risk.
