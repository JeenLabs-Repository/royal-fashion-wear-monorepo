# Razorpay Node SDK Surface And Header Transport

Status: accepted

Date: 2026-11-25

## Context

The provider calls Razorpay through the official Node package. The method names, whether a per-call header such as `X-Refund-Idempotency` can be sent and where the signature helper lives were read from documentation, so they were read from the package source instead of guessed.

## Method

The exact approved version `razorpay@2.9.8` was downloaded as a tarball with `npm pack --ignore-scripts` into an empty temporary directory and read without installing or running any package script. A ten-line comparison script, written by hand, ran the SDK signature helper and `node:crypto` on the same input.

## Observed

### SDK

Version read: 2.9.8. Constructor options: `key_id`, `key_secret`, optional `headers`, optional `oauthToken` (`dist/razorpay.js` lines 18–33; `dist/razorpay.d.ts` `IRazorpayConfig`). TypeScript declarations ship with the package: yes (`dist/razorpay.d.ts` and `dist/types/*`).

| Call | Observed method and argument order | File and line |
|---|---|---|
| create an order | `orders.create(params, callback?)` | `dist/resources/orders.js` line 61 |
| fetch an order | `orders.fetch(orderId, callback?)` | `dist/resources/orders.js` line 53 |
| fetch an order's payments | `orders.fetchPayments(orderId, callback?)` | `dist/resources/orders.js` line 86 |
| fetch a payment | `payments.fetch(paymentId, params?, callback?)` | `dist/resources/payments.js` line 49 |
| list payments | `payments.all(params?, callback?)` | `dist/resources/payments.js` line 17 |
| capture a payment | `payments.capture(paymentId, amount, currency?, callback?)` | `dist/resources/payments.js` line 68 |
| refund a payment | `payments.refund(paymentId, params?, callback?)` — body only, no headers arg | `dist/resources/payments.js` lines 122–131 |
| list a payment's refunds | `payments.fetchMultipleRefund(paymentId, params?, callback?)` | `dist/resources/payments.js` line 133 |

Per-call headers on the refund call: no. The constructor `headers` option applies to every call: yes, but `dist/api.js` `allowedHeaders` (lines 16–19) and `getValidHeaders` only forward `X-Razorpay-Account` and `Content-Type`, so `X-Refund-Idempotency` cannot be sent through the SDK client at all. The idempotency header named `X-Refund-Idempotency` can be sent by: a direct HTTPS request helper (global `fetch` or equivalent) with HTTP basic auth using `key_id`/`key_secret`.

Signature helper: `validateWebhookSignature(body, signature, secret)` in `dist/utils/razorpay-utils.js` line 55 (also `Razorpay.validateWebhookSignature` static). Comparison run: `valid sdk: true node:crypto: true` and `tampered sdk: false node:crypto: false`.

Decision for the plans: Header transport for the refund idempotency key: SDK per-call option no; direct HTTPS request helper yes; client constructor: `new Razorpay({ key_id, key_secret })` (constructor `headers` cannot carry `X-Refund-Idempotency`); names to use: `orders.create`, `orders.fetch`, `orders.fetchPayments`, `payments.fetch`, `payments.all`, `payments.capture`, `payments.refund` (body only), `payments.fetchMultipleRefund`, plus a small refund helper for the idempotency header; signature helper path: `dist/utils/razorpay-utils.js` `validateWebhookSignature(body, signature, secret)` (cross-check with `node:crypto` in unit tests).

## Decision

Pin and call `razorpay@2.9.8` with the method names above. Verify webhook signatures with `node:crypto` HMAC SHA256 hex and cross-check against `validateWebhookSignature` in unit tests. Send `X-Refund-Idempotency` through a dedicated HTTPS helper, not through the SDK refund method or constructor headers.

## Consequences

The payment provider keeps the official client for orders and payment reads, and adds one thin refund request helper. Plans must not assume a per-call headers argument on `payments.refund`.

Undo cost: reversible, because only this record remains and no app dependency on `razorpay` was added in this change.
