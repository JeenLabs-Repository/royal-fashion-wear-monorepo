# Razorpay Refund And Payment State Behaviour On Medusa 2.22.7

Status: accepted

Date: 2026-11-25

## Context

Refunds must be safe to retry and must update order totals, and a failed, late, duplicate or unknown payment event must never leave Razorpay retrying for days or leave an order unpaid. These behaviours were read from documentation and never run, so they were observed before the provider and the webhook guard depend on them.

## Method

Medusa 2.22.7 exactly, the scratch provider of the previous record, a throwaway worktree and database. Razorpay's own API was exercised only when the owner supplied test credentials; ids are masked to eight characters and no secret is recorded.

## Observed

### S3 Refunds

| Refund | HTTP status | Amount type and value the provider received | Data replayed to the provider | Order totals after |
|---|---|---|---|---|
| 40 | 200 | object BigNumber-like `{ value: "40", precision: 20 }` (rupees, not paise); `context.idempotency_key` is the refund id | first call: prior `data` without refund counters | `refunded_total` 40, `payment_status` partially_refunded, order total 565 |
| 30 | 200 | same shape, value `"30"` | yes: `data_in` held `refund_calls: 1` and `refunds: [{ value: "40", … }]` | `refunded_total` 70, total 535 |
| over the remainder (545) | 400 | provider not called | n/a | unchanged (`refunded_total` 70); core message "You are not allowed to refund more than the captured amount" |
| provider throws | 400 `not_allowed` "scratch provider refused the refund" | object value `"10"` | n/a | no refund record (`refunds: 0`); `refunded_total` 0; `payment_status` stays captured |

Route: `POST /admin/payments/:id/refund` (confirmed under `@medusajs/medusa` `dist/api/admin/payments/[id]/refund`). Event after a refund: `payment.refunded` with payload keys `["id"]`.

Razorpay side: not run: owner credentials absent; covered by the mocked transport test and the end-to-end spec when keys exist.

Decision for the plans: Refund route: `POST /admin/payments/:id/refund`; amount unit passed to the provider: Medusa BigNumber-like object in rupees (`{ value, precision }`, not paise); provider-returned data persisted and replayed: yes; refund event name and payload keys: `payment.refunded` with `["id"]`; provider error leaves no refund record: yes; refund count source for the idempotency key: persisted provider `data` (`refund_calls` / length of `refunds`) replayed on the next `refundPayment` input (also mirrored by core Payment `refunds` rows).

### S4 Failed, late, duplicate and unknown events

| Case | Session status after | Cart or order effect | HTTP status Razorpay would see |
|---|---|---|---|
| failed event | stays pending (subscriber ignores `failed`) | no Payment, cart not completed | 200 `OK` |
| captured after failed | recovers | Payment created and captured; cart completes (webhook and/or idempotent complete) | 200 `OK` |
| captured after completion | unchanged | second `captured` no extra Payment; order stays captured | 200 `OK` |
| unknown session id | n/a | async `PaymentSession … was not found`; no order | 200 `OK` |
| same signed body twice | provider has no memory | two `getWebhookActionAndData` calls; de-duplication is the guard's job | 200 `OK` both times |

Decision for the plans: Failed then captured recovers: yes; captured after completion: no-op (order and Payment unchanged); unknown session status: HTTP 200 from the core route with an async subscriber error; status the guard must return for an unknown session: 200 (acknowledge so Razorpay does not retry; do not process).

## Decision

Use the core refund route and treat provider `data` as the refund-count source for the D-05 idempotency key (convert the BigNumber amount to paise only at the Razorpay boundary). A provider throw returns 400 and creates no refund row. Failed webhook actions are ignored by core; a later `captured` recovers. The guard must de-duplicate by event id and return 200 for unknown sessions; invalid signatures remain a separate 400 policy on the guard because the core route always answers 200.

## Consequences

Provider refund code must read `input.amount` as a decimal rupee BigNumber and convert with `toPaise()`. Idempotency key count comes from persisted `data.refund_calls` (or equivalent) after confirming replay. Session-state handling for UPI late success can rely on a subsequent `captured` webhook. Duplicate webhooks need the event-id table in the guard, not the payment provider.

Undo cost: reversible, because only this record remains.
