# Review the Daily Payment Reconciliation

Every day at 02:30 India time the store checks the last 48 hours of Razorpay payments against its own payments and orders. This guide explains what the check finds and what you do about each finding.

## What the Check Compares

The check asks Razorpay for every payment created in the last 48 hours. It then compares each one with the matching payment and order in the store. It looks at the payment state, the amount and the amount refunded.

If more than 2,000 payments were created in the window, the run stops at 2,000 and the list shows a Truncated tag. Check the Razorpay dashboard for the rest on that day.

## Who Can See It and Who Can Act

Staff with the finance read permission can open Payment reconciliation and see runs and items. Only staff who can issue refunds see a working Refund in full button. Everyone else gets a no access message.

## What Each Kind Means

- **Paid, no order.** Razorpay captured the money but the store has no order. The customer paid and got nothing. Open the payment in the Razorpay dashboard to confirm, then press Refund in full. The refund goes out once, even if you press twice.
- **Order, payment not captured.** The store has an order but Razorpay shows no captured payment. Do not ship the order. Find the payment in the Razorpay dashboard and decide whether to cancel the order.
- **Amount differs.** Razorpay captured a different amount than the order total. Compare both in the Razorpay dashboard and correct the difference with a refund or a note on the order.
- **Refund differs.** The amount refunded at Razorpay does not match the refunds on the order. Compare both and correct the order or the refund.

## What the Alert Email Means

When a run finds at least one mismatch, or stops early, the owner and finance staff get one email for that day. A day with no problems sends no email. A run that fails to finish sends one email that names the reason.

## Rehearse in Development

Run the demo script against your development database to create a run with one open payment and one resolved payment:

- Start the backend and sign in to the Admin.
- Run `pnpm -C apps/backend exec medusa exec ./src/scripts/seed-reconciliation-demo.ts`.
- Open Payment reconciliation, select the newest run and check the two rows.

The script uses fixed fake payment ids, makes no call to Razorpay and refuses to run in production. Pressing Refund in full on a demo row fails at the gateway, so only confirm the dialog in a test account that has Razorpay test keys.
