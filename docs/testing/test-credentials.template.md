# Test Credentials

This file is the standard structure of `TEST-CREDENTIALS.local.md`. The real file lives at the repository root, is ignored by git and holds demo values only. The seed script creates it from these headings and Playwright specs append rows to it. Never put real customer data or production secrets in it.

Each entry says what it is, which flow created it and how to reset it.

## Accounts by role

The seed script writes the baseline accounts between the markers below. Rows that specs append go in the table after them. The columns of the seed table are role, email, password, created by and how to reset.

<!-- seed:start -->
<!-- seed:end -->

Catalog approver, order router, support, finance read-only and vendor accounts are added by later releases.

| What | Flow | Values | How to reset |
|---|---|---|---|

## Form values

| What | Flow | Values | How to reset |
|---|---|---|---|

## Orders

| What | Flow | Values | How to reset |
|---|---|---|---|

## Settings-card values

| What | Flow | Values | How to reset |
|---|---|---|---|

## Razorpay test values

All values here are owner to provide. Record only test-mode values.

| What | Flow | Values | How to reset |
|---|---|---|---|

## Owner to provide

- Razorpay test key id and secret
- Razorpay webhook secret
- Real SMTP credentials, only if real mail is ever needed
- GitHub repository name and signing key details

## Reset notes

Run these steps from the repository root to return to a clean demo state.

1. Stop the stack and drop its volumes with `docker compose -f docker-compose.dev.yml down -v`.
2. Bring it up again with `docker compose -f docker-compose.dev.yml up -d --wait`.
3. Run `pnpm medusa db:migrate` from `apps/backend`.
4. Run `pnpm backend:seed`, then `pnpm backend:seed:test`.
