# How a Payment Becomes an Order

This page explains how a customer's payment turns into an order, what happens when something goes wrong, and which parts need an owner.

## The Path From Pay to Order

1. The customer presses pay. The backend creates a Razorpay order for the payment session. The session id is the receipt and the only note on the order.
2. The Razorpay Checkout window opens in the storefront. The customer pays by card, UPI or another method the window offers.
3. Razorpay captures the payment.
4. Two routes can now create the order. The browser calls cart completion when the window reports success. Separately, Razorpay sends a signed webhook to the backend.
5. Whichever route arrives first creates the order. The other finds the order or the lock and does nothing. Completion is idempotent: the same payment never creates two orders.

If the customer closes the tab after paying, or pays in another app with UPI, only the webhook route runs, and it still creates the order.

## What the Platform Does on Its Own

Recorded result (checked on Medusa 2.22.7): a captured payment webhook completes the cart and creates the order through the core payment webhook path. Both `authorized` and `captured` webhook actions complete the cart. This store maps Razorpay `payment.captured` and `order.paid` to `captured` so the order payment status is captured. No separate cart completion workflow is required for this Medusa version.

## What the Webhook Check Answers

The webhook route is public, so every request goes through a guard before the core payment route runs. The guard checks the signature on the exact bytes received, records the event id in a ledger, and answers:

| Answer | When | Why |
|--------|------|-----|
| 400 | The signature is missing or wrong, the event id is missing or the body is not an event | A forged or damaged request must never be retried into success |
| 503 | No Razorpay card is saved, or it has no webhook secret | The store cannot check the signature yet, so Razorpay should try again later |
| 200 with duplicate | The event id was already processed | Razorpay retries when it gets no answer, so a repeat must be harmless |
| 200 with ignored | The payment is already captured, the session is unknown or the event is malformed | Retrying would never succeed, so the event is acknowledged and surfaced |
| 500 | Processing failed | Razorpay retries an event that was not acknowledged with a 2xx answer, with growing gaps, so a temporary fault heals itself |

Late events are safe. A payment failed event or an order paid event that arrives after a processed capture changes nothing.

## The Pending Page

When a payment finishes in another app, the storefront shows a pending page. It checks the order every 3 seconds for up to 5 minutes. After that it tells the customer that an email will arrive when the order completes, because the webhook finishes the order in the background.

## When Completion Fails After Capture

If the order cannot be created after the payment was captured (for example the stock ran out), the payment is an orphan: the customer paid and no order exists. The core route has already answered 200, so the ledger marks the event processed and Razorpay will not retry that event id. The store surfaces the payment on the reconciliation screen and raises a staff alert that names the payment id and the amount only. Staff refund it in full from that screen. The customer gets no order email until staff act.

## Events the Plugin Announces

The plugin announces captured, failed and orphan payments and refund events. The refund recorder keeps the refund list on the order up to date. A staff alert subscriber listens for orphan and failed refund events, and the daily reconciliation job separately finds payments without orders by comparing the gateway with the store.

## What the Owner Provides

- Razorpay test keys, and later live keys, saved on the Razorpay card in Settings.
- The webhook secret, set in the Razorpay dashboard and saved on the same card.
- A tunnel such as cloudflared, so Razorpay can reach a local backend during manual tests.
