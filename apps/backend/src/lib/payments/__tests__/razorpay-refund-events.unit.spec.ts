jest.mock(
  "@jeenlabs-repository/medusa-payment-razorpay/public",
  () => ({
    RAZORPAY_EVENTS: {
      refundRecorded: "razorpay.refund.recorded",
      refundFailed: "razorpay.refund.failed",
      paymentOrphan: "razorpay.payment.orphan",
    },
    fromPaise: (value: number) => (value / 100).toFixed(2),
  }),
  { virtual: true }
);
jest.mock("../staff-hooks", () => ({
  notifyStaff: jest.fn(async () => true),
  auditPayment: jest.fn(async () => true),
}));

import razorpayRefundEventsHandler, {
  config,
  handleRefundEvent,
} from "../../../subscribers/razorpay-refund-events";
import { auditPayment, notifyStaff } from "../staff-hooks";

const logger = { warn: jest.fn(), error: jest.fn() };
const container = {
  resolve: (key: string) => (key === "logger" ? logger : undefined),
} as never;

const refund = { razorpay_refund_id: "rfnd_1", razorpay_payment_id: "pay_1", amount_paise: 4000 };

beforeEach(() => jest.clearAllMocks());

describe("refund and orphan events", () => {
  it("subscribes to the three events", () => {
    expect(config.event).toEqual([
      "razorpay.refund.recorded",
      "razorpay.refund.failed",
      "razorpay.payment.orphan",
    ]);
  });

  it("audits a recorded refund with ids and the amount in paise", async () => {
    await handleRefundEvent(container, "razorpay.refund.recorded", refund);
    expect(auditPayment).toHaveBeenCalledTimes(1);
    const input = (auditPayment as jest.Mock).mock.calls[0][1];
    expect(input.action).toBe("refund.issued");
    expect(input.target).toEqual({ type: "payment", id: "pay_1" });
    expect(input.meta).toEqual({
      razorpay_payment_id: "pay_1",
      razorpay_refund_id: "rfnd_1",
      amount_paise: 4000,
    });
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("alerts support, finance and the owner once for a failed refund", async () => {
    await handleRefundEvent(container, "razorpay.refund.failed", refund);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    const input = (notifyStaff as jest.Mock).mock.calls[0][1];
    expect(input.kind).toBe("refund-failed");
    expect(input.roleKeys).toEqual(["superadmin", "finance_readonly", "support"]);
    expect(input.idempotencyKey).toBe("refund-failed:rfnd_1:once");
    expect(input.lines[0]).toBe("Refund rfnd_1 of INR 40.00 on payment pay_1 failed.");
    expect(auditPayment).not.toHaveBeenCalled();
  });

  it("alerts for an orphan reported by the webhook, keyed by the payment id", async () => {
    await handleRefundEvent(container, "razorpay.payment.orphan", {
      event_id: "evt_1",
      event_type: "payment.captured",
      razorpay_payment_id: "pay_9",
      razorpay_order_id: "order_9",
      amount_paise: 49900,
    });
    const input = (notifyStaff as jest.Mock).mock.calls[0][1];
    expect(input.kind).toBe("payment-orphan");
    expect(input.roleKeys).toEqual(["superadmin", "finance_readonly"]);
    expect(input.idempotencyKey).toBe("payment-orphan:pay_9:once");
    expect(input.lines[0]).toContain("INR 499.00");
  });

  it("keys an orphan reported by the completion step by the session id", async () => {
    await handleRefundEvent(container, "razorpay.payment.orphan", {
      payment_session_id: "payses_1",
      razorpay_payment_id: "pay_9",
      reason: "completion_failed",
    });
    const input = (notifyStaff as jest.Mock).mock.calls[0][1];
    expect(input.idempotencyKey).toBe("payment-orphan:payses_1:once");
    expect(input.lines[0]).toContain("an unknown amount");
  });

  it("copies nothing but ids and amounts into alert lines", async () => {
    await handleRefundEvent(container, "razorpay.payment.orphan", {
      razorpay_payment_id: "pay_9",
      amount_paise: 100,
      email: "buyer@example.test",
      contact: "+919876543210",
    });
    const serialised = JSON.stringify((notifyStaff as jest.Mock).mock.calls[0][1]);
    expect(serialised).not.toContain("buyer@example.test");
    expect(serialised).not.toContain("9876543210");
  });

  it("warns and sends nothing for a malformed refund payload", async () => {
    await handleRefundEvent(container, "razorpay.refund.recorded", { amount_paise: "40" });
    await handleRefundEvent(container, "razorpay.refund.failed", {});
    await handleRefundEvent(container, "razorpay.payment.orphan", { amount_paise: 1 });
    expect(auditPayment).not.toHaveBeenCalled();
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it("ignores an unknown event name", async () => {
    await handleRefundEvent(container, "razorpay.payment.captured", refund);
    expect(auditPayment).not.toHaveBeenCalled();
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("logs and does not throw when the audit adapter rejects", async () => {
    (auditPayment as jest.Mock).mockRejectedValueOnce(new Error("audit down"));
    await expect(
      handleRefundEvent(container, "razorpay.refund.recorded", refund)
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("logs and does not throw when the alert adapter rejects", async () => {
    (notifyStaff as jest.Mock).mockRejectedValueOnce(new Error("mail down"));
    await expect(
      handleRefundEvent(container, "razorpay.refund.failed", refund)
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("dispatches on the event name through the default handler", async () => {
    await razorpayRefundEventsHandler({
      event: { name: "razorpay.refund.failed", data: refund },
      container,
    } as never);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
  });

  it("does not leak the gateway key or idempotency header into lines", async () => {
    await handleRefundEvent(container, "razorpay.refund.failed", {
      ...refund,
      idempotency_key: "a".repeat(64),
    });
    expect(JSON.stringify((notifyStaff as jest.Mock).mock.calls[0][1])).not.toContain(
      "a".repeat(64)
    );
  });
});
