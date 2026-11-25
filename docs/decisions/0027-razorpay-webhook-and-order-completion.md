# Razorpay Webhook Path And Order Completion On Medusa 2.22.7

Status: accepted

Date: 2026-11-25

## Context

The Razorpay provider and the webhook guard are built on assumptions about Medusa that were read from documentation: the webhook path, whether the provider receives the exact bytes Razorpay signed, which webhook action completes the cart and creates the order, and what Razorpay sees when the provider throws. A wrong answer changes the provider, the guard and whether an extra cart-completion workflow must exist, so each was observed before anything depends on it.

## Method

Medusa 2.22.7 exactly. A scratch payment provider with the identifier `razorpay` in a throwaway worktree and database, driven by signed requests sent with the exact bytes of a file and a fake secret. The scratch provider keeps no real credentials. Everything scratch was deleted afterwards. Core route source: `@medusajs/medusa` `api/hooks/payment/[provider]/route.js` emits `payment.webhook_received` then always `res.sendStatus(200)` unless the provider id is missing (then 400). Default event delay is 5000 ms (`options.webhook_delay`).

## Observed

### S1 Webhook path and raw body

| Request | Provider saw raw data as | Raw-bytes signature matched | Re-serialised signature matched | HTTP status and body |
|---|---|---|---|---|
| A compact body, valid signature | Buffer (`raw_is_buffer: true`) | yes | yes | 200 `OK` (async subscriber ran; `not_supported` ignored) |
| B reformatted body, valid signature | Buffer | yes | no | 200 `OK` (async subscriber ran; `not_supported` ignored) |
| C invalid signature | Buffer | no | no | 200 `OK`; async subscriber logged `MedusaError` `invalid_data` "invalid webhook signature" |
| no signature header | Buffer | no | no | 200 `OK`; same async `MedusaError` as C |
| provider throws a plain error | Buffer | yes | yes | 200 `OK`; async subscriber logged plain `Error` "scratch plain error" |
| unknown session id | Buffer | yes | yes | 200 `OK`; provider accepted `captured`; `processPaymentWorkflow` then failed with "PaymentSession with id: payses_unknown was not found" |

Route used: `POST /hooks/payment/razorpay_razorpay` (provider param without `pp_`; core prefixes `pp_`). Header key casing seen by the provider: lower-case (`x-razorpay-signature` among keys). Receipt source: `input.context.idempotency_key` equals the payment session id (`payses_…`). Plugin-style guard from the mechanics record can answer before the core route (observed in that record); needed here because the core route cannot return 4xx for a provider throw.

Decision for the plans: Webhook path: `POST /hooks/payment/razorpay_razorpay`; rawData type: Buffer; header casing: lower-case; status for provider throw: HTTP 200 from the core route (errors only in the async `payment.webhook_received` subscriber); receipt source: `input.context.idempotency_key` (payment session id).

### S2 Which action completes the cart

| Trial | Action sent | Cart completed | Session / payment | Payment exists | Payment captured at | Order exists | Order payment status | Complete call afterwards |
|---|---|---|---|---|---|---|---|---|
| a | none (complete first) | no | pending (authorize refused) | no | n/a | no new order | n/a | HTTP 400 `Session … was not authorized with the provider` |
| b | authorized | yes (from webhook) | payment created | yes | null | yes | authorized | HTTP 200 returns the existing order (idempotent) |
| c | captured | yes (from webhook) | payment created and captured | yes | set | yes | captured | HTTP 200 returns the existing order (idempotent) |
| d | authorized then captured | yes (from webhook) | payment created and captured | yes | set | yes | captured | HTTP 200 returns the existing order (idempotent) |

Decision for the plans: Action that completes the cart without the browser: both `authorized` and `captured` (core `processPaymentWorkflow` via the webhook subscriber); action that creates and captures the Payment: `captured` (`PaymentActions.SUCCESSFUL`; `authorized` creates a Payment with `captured_at` null); mapping to use for payment.captured and order.paid: `captured`; conditional completion workflow needed: no (the webhook path already completes the cart and creates the order).

## Decision

Providers must verify the Razorpay signature on `payload.rawData` as a Buffer and never on re-stringified JSON. The composed webhook URL is `POST /hooks/payment/razorpay_razorpay`. Because Medusa acknowledges every hook with HTTP 200 before the provider runs, signature rejection and unknown-session handling must live in a middleware guard that answers before the core route (as decided in the plugin mechanics record). Map Razorpay `payment.captured` and `order.paid` to action `captured`. Do not add a separate cart-completion workflow: 2.22.7 already completes the cart from the webhook for both `authorized` and `captured`. Prefer `captured` for auto-capture checkout so the order payment status is `captured`.

## Consequences

The webhook guard must return a non-success status for invalid signatures if Razorpay should retry, and must decide the status for unknown sessions (see the refund and session-state record). Provider plans use receipt from `context.idempotency_key`. Storefront cart complete remains useful for the browser path and is idempotent after a successful webhook. No conditional `completeCartFromPaymentWorkflow` is required for 2.22.7.

Undo cost: reversible, because only this record remains and no production provider code depends on it yet.
