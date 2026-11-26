jest.mock(
  "@jeenlabs-repository/medusa-payment-razorpay/public",
  () => ({ fromPaise: (value: number) => (value / 100).toFixed(2) }),
  { virtual: true }
);

import {
  ageHours,
  emptyBodySchema,
  listQuerySchema,
  parseInput,
  refundsQuerySchema,
  toItemView,
  toRefundView,
  toRunView,
} from "../razorpay-admin-views";

const item = {
  id: "rzri_1",
  kind: "captured_no_order",
  razorpay_payment_id: "pay_1",
  razorpay_order_id: "order_1",
  medusa_payment_id: null,
  payment_session_id: "payses_1",
  amount_paise: 49900,
  resolved_at: null,
  resolved_note: null,
  detail: { reason: "no_session", email: "buyer@example.test" },
  run_id: "rzrr_1",
};

describe("razorpay admin views", () => {
  it("returns exactly the run fields and drops the rest", () => {
    const view = toRunView({
      id: "rzrr_1",
      started_at: "2026-03-05T21:00:00.000Z",
      finished_at: null,
      status: "completed",
      scanned_count: 3,
      mismatch_count: 1,
      truncated: false,
      window_hours: 48,
      error: "x",
    } as never);
    expect(Object.keys(view).sort()).toEqual([
      "finished_at",
      "id",
      "mismatch_count",
      "scanned_count",
      "started_at",
      "status",
      "truncated",
    ]);
  });

  it("never exposes the detail document or the run id on an item", () => {
    const view = toItemView(item as never, "2026-03-05T21:00:00.000Z", new Date("2026-03-06T00:00:00Z"));
    expect(view).not.toHaveProperty("detail");
    expect(view).not.toHaveProperty("run_id");
    expect(JSON.stringify(view)).not.toContain("buyer@example.test");
  });

  it("formats the amount as a rupee string", () => {
    const view = toItemView(item as never, null, new Date());
    expect(view.amount_inr).toBe("499.00");
    expect(view.amount_paise).toBe(49900);
  });

  it("marks only unresolved orphans as refundable", () => {
    const now = new Date();
    expect(toItemView(item as never, null, now).refundable).toBe(true);
    expect(toItemView({ ...item, resolved_at: now } as never, null, now).refundable).toBe(false);
    expect(toItemView({ ...item, kind: "amount_mismatch" } as never, null, now).refundable).toBe(false);
    expect(toItemView({ ...item, razorpay_payment_id: null } as never, null, now).refundable).toBe(false);
  });

  it("counts whole hours from the run start and never goes negative", () => {
    const now = new Date("2026-03-06T05:30:00Z");
    expect(ageHours("2026-03-05T21:00:00Z", now)).toBe(8);
    expect(ageHours("2026-03-07T00:00:00Z", now)).toBe(0);
    expect(ageHours(null, now)).toBe(0);
  });

  it("leaves the idempotency key and the Medusa payment id out of a refund view", () => {
    const view = toRefundView({
      razorpay_refund_id: "rfnd_1",
      razorpay_payment_id: "pay_1",
      amount_paise: 4000,
      status: "pending",
      created_at: "2026-03-05T00:00:00Z",
      updated_at: "2026-03-05T00:00:00Z",
      idempotency_key: "k".repeat(64),
      medusa_payment_id: "pay_medusa",
    } as never);
    expect(view.amount_inr).toBe("40.00");
    expect(JSON.stringify(view)).not.toContain("k".repeat(64));
    expect(view).not.toHaveProperty("medusa_payment_id");
  });

  it("validates the list query strictly with a default of 20", () => {
    expect(parseInput(listQuerySchema, {})).toEqual({ limit: 20 });
    expect(parseInput(listQuerySchema, { limit: "50" })).toEqual({ limit: 50 });
    expect(() => parseInput(listQuerySchema, { limit: "0" })).toThrow();
    expect(() => parseInput(listQuerySchema, { limit: "51" })).toThrow();
    expect(() => parseInput(listQuerySchema, { limit: "5", extra: "1" })).toThrow();
  });

  it("requires a payment id and rejects unknown query keys", () => {
    expect(() => parseInput(refundsQuerySchema, {})).toThrow();
    expect(() => parseInput(refundsQuerySchema, { payment_id: "" })).toThrow();
    expect(() => parseInput(refundsQuerySchema, { payment_id: "pay_1", x: "1" })).toThrow();
    expect(parseInput(refundsQuerySchema, { payment_id: "pay_1" })).toEqual({ payment_id: "pay_1" });
  });

  it("accepts only an empty body", () => {
    expect(parseInput(emptyBodySchema, undefined)).toEqual({});
    expect(() => parseInput(emptyBodySchema, { amount: 1 })).toThrow();
  });
});
