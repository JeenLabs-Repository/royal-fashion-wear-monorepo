import type { MedusaContainer, SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { RAZORPAY_EVENTS, fromPaise } from "@jeenlabs-repository/medusa-payment-razorpay/public";
import { auditPayment, notifyStaff } from "../lib/payments/staff-hooks";

const TAG = "[razorpay-refund-events]";

type HandlerLogger = { warn(message: string): void; error(message: string): void };

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const paise = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "unknown error";

/**
 * Alert and audit lines carry ids and amounts only. Nothing else from the
 * event payload is copied, so customer data cannot reach an email or the audit log.
 */
export async function handleRefundEvent(
  container: MedusaContainer,
  name: string,
  data: unknown
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as unknown as HandlerLogger;
  const row = (data ?? {}) as Record<string, unknown>;

  try {
    if (name === RAZORPAY_EVENTS.refundRecorded) {
      const refundId = text(row.razorpay_refund_id);
      const paymentId = text(row.razorpay_payment_id);
      const amount = paise(row.amount_paise);
      if (!refundId || !paymentId || amount === null) {
        logger.warn(`${TAG} refund event ignored: unexpected payload`);
        return;
      }
      await auditPayment(container as never, {
        action: "refund.issued",
        target: { type: "payment", id: paymentId },
        meta: {
          razorpay_payment_id: paymentId,
          razorpay_refund_id: refundId,
          amount_paise: amount,
        },
      });
      return;
    }

    if (name === RAZORPAY_EVENTS.refundFailed) {
      const refundId = text(row.razorpay_refund_id);
      const paymentId = text(row.razorpay_payment_id);
      const amount = paise(row.amount_paise);
      if (!refundId || !paymentId || amount === null) {
        logger.warn(`${TAG} refund failure ignored: unexpected payload`);
        return;
      }
      await notifyStaff(container as never, {
        kind: "refund-failed",
        roleKeys: ["superadmin", "finance_readonly", "support"],
        subject: "A refund failed at the payment gateway",
        heading: "A refund did not go through",
        lines: [
          `Refund ${refundId} of INR ${fromPaise(amount)} on payment ${paymentId} failed.`,
          "The customer has not received this money. Check the payment in the Razorpay dashboard and issue the refund again if needed.",
        ],
        idempotencyKey: `refund-failed:${refundId}:once`,
      });
      return;
    }

    if (name === RAZORPAY_EVENTS.paymentOrphan) {
      const paymentId = text(row.razorpay_payment_id);
      const subject = text(row.payment_session_id) ?? paymentId;
      const amount = paise(row.amount_paise);
      if (!paymentId || !subject) {
        logger.warn(`${TAG} orphan event ignored: unexpected payload`);
        return;
      }
      const amountText = amount === null ? "an unknown amount" : `INR ${fromPaise(amount)}`;
      await notifyStaff(container as never, {
        kind: "payment-orphan",
        roleKeys: ["superadmin", "finance_readonly"],
        subject: "A payment was captured but no order exists",
        heading: "Money was received without an order",
        lines: [
          `Payment ${paymentId} of ${amountText} was captured and the order could not be completed.`,
          "Open Payment reconciliation in the Admin and refund it in full, or complete the order by hand.",
        ],
        idempotencyKey: `payment-orphan:${subject}:once`,
      });
      return;
    }

    logger.warn(`${TAG} ignored event ${name}`);
  } catch (error) {
    logger.error(`${TAG} ${name} handler failed: ${messageOf(error)}`);
  }
}

export default async function razorpayRefundEventsHandler({
  event,
  container,
}: SubscriberArgs<unknown>): Promise<void> {
  await handleRefundEvent(container, event.name, event.data);
}

export const config: SubscriberConfig = {
  event: [
    RAZORPAY_EVENTS.refundRecorded,
    RAZORPAY_EVENTS.refundFailed,
    RAZORPAY_EVENTS.paymentOrphan,
  ],
};
