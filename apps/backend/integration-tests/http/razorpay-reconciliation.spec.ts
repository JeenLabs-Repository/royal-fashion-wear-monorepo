import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  RAZORPAY_LEDGER_MODULE,
  reconcileRazorpayPaymentsWorkflow,
} from "@jeenlabs-repository/medusa-payment-razorpay/public";
import { auditPayment, notifyStaff } from "../../src/lib/payments/staff-hooks";
import { createPayableCart, paiseOf } from "../helpers/payable-cart";
import { buildEventBody, signAndPost, waitForOrder } from "../helpers/razorpay-webhook";
import {
  gatewayPayment,
  installGatewayScript,
  type GatewayScript,
} from "../helpers/razorpay-gateway-script";
// <RESOLVE: where adminHeadersFor lives. Command:
// grep -rln "export async function adminHeadersFor" apps/backend/integration-tests/helpers>
import { adminHeadersFor } from "../helpers/admin-as";

jest.mock("../../src/lib/payments/staff-hooks", () => ({
  notifyStaff: jest.fn(async () => true),
  auditPayment: jest.fn(async () => true),
}));

jest.setTimeout(180 * 1000);

const governanceApplied = existsSync(
  resolve(process.cwd(), "src/lib/rbac/permission-manifest.ts")
);

const istDate = (now: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

const eventually = async (check: () => void, timeoutMs = 10000): Promise<void> => {
  const started = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) {
        throw error;
      }
      await new Promise((done) => setTimeout(done, 150));
    }
  }
};

const call = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    return (error as { response: T }).response;
  }
};

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("payment reconciliation", () => {
      let headers: Record<string, string>;
      let script: GatewayScript;
      let counter = 0;

      const nextId = (prefix: string) => `${prefix}${String(++counter).padStart(8, "0")}`;

      const ORPHAN_PRICE = "499.00";

      // A gateway payment that was captured while the cart was never completed.
      const seedOrphan = async () => {
        // The cart total equals the unit price: prices include tax and shipping is 0.00.
        const cart = await createPayableCart(getContainer(), {
          api,
          adminHeaders: headers,
          unitPrice: ORPHAN_PRICE,
          shippingPrice: "0.00",
        });
        const amountPaise = Number(paiseOf(ORPHAN_PRICE));
        const paymentId = nextId("pay_ORPH");
        script.payments.set(
          paymentId,
          gatewayPayment(paymentId, cart.razorpay_order_id as string, amountPaise, "captured")
        );
        return { cart, paymentId, amountPaise };
      };

      // An order paid through a signed captured webhook, with a matching gateway payment.
      const seedPaidOrder = async (unitPrice = "100.00") => {
        const cart = await createPayableCart(getContainer(), {
          api,
          adminHeaders: headers,
          unitPrice,
          shippingPrice: "0.00",
        });
        // Core completion asks the (fake) SDK client what the gateway holds for the order.
        cart.gateway.payments = [{ status: "captured", amount_rupees: unitPrice }];
        const orderId = cart.razorpay_order_id as string;
        const amountPaise = Number(paiseOf(unitPrice));
        const paymentId = nextId("pay_PAID");
        // <RESOLVE: field names of EventFields. Command:
        // grep -n "export type EventFields" -A6 apps/backend/integration-tests/helpers/razorpay-webhook.ts>
        const posted = await signAndPost(
          api,
          buildEventBody("payment.captured", {
            paymentId,
            razorpayOrderId: orderId,
            sessionId: cart.session_id as string,
            amountPaise: paiseOf(unitPrice),
          }),
          {
            secret: (cart.card as { webhook_secret: string }).webhook_secret,
            eventId: `evt_${paymentId}`,
          }
        );
        expect(posted.status).toBe(200);
        await waitForOrder(getContainer(), cart.cart_id);
        script.payments.set(paymentId, gatewayPayment(paymentId, orderId, amountPaise, "captured"));
        return { cart, paymentId, amountPaise, orderId };
      };

      const reconcile = async (now = new Date()) => {
        const { result } = await reconcileRazorpayPaymentsWorkflow(getContainer()).run({
          input: { now: now.toISOString() },
        });
        return { result, now };
      };

      const itemsOf = async (runId: string) => {
        const ledger = getContainer().resolve(RAZORPAY_LEDGER_MODULE) as unknown as {
          listItemsForRun(id: string): Promise<{ id: string; kind: string; amount_paise: number }[]>;
        };
        return ledger.listItemsForRun(runId);
      };

      beforeEach(async () => {
        jest.clearAllMocks();
        script = installGatewayScript();
        headers = await adminHeadersFor(api, getContainer(), "superadmin");
      });

      afterEach(() => script.restore());

      it("reports a payment captured without an order, alerts once and audits the run", async () => {
        const { amountPaise, paymentId } = await seedOrphan();
        const { result, now } = await reconcile();

        const items = await itemsOf(result.run_id);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ kind: "captured_no_order", amount_paise: amountPaise });
        expect(result).toMatchObject({ mismatch_count: 1, truncated: false });
        expect(script.requests.some((r) => r.path.startsWith("payments"))).toBe(true);
        expect(paymentId).toBeTruthy();

        await eventually(() => {
          expect(notifyStaff).toHaveBeenCalledTimes(1);
          expect(auditPayment).toHaveBeenCalledTimes(1);
        });
        const alert = (notifyStaff as jest.Mock).mock.calls[0][1];
        expect(alert.idempotencyKey).toBe(`recon:${istDate(now)}:daily`);
        expect(alert.roleKeys).toEqual(["superadmin", "finance_readonly"]);
        expect((auditPayment as jest.Mock).mock.calls[0][1]).toMatchObject({
          action: "payment.reconciliation_run",
          target: { type: "reconciliation_run", id: result.run_id },
        });
      });

      it("finishes the run as completed with the scanned count", async () => {
        await seedOrphan();
        const { result } = await reconcile();
        const ledger = getContainer().resolve(RAZORPAY_LEDGER_MODULE) as unknown as {
          listRazorpayReconciliationRuns(f: object): Promise<{ status: string; scanned_count: number }[]>;
        };
        const [run] = await ledger.listRazorpayReconciliationRuns({ id: result.run_id });
        expect(run).toMatchObject({ status: "completed", scanned_count: 1 });
      });

      it("reports an amount that differs from the order", async () => {
        const { orderId, amountPaise, paymentId } = await seedPaidOrder();
        script.payments.set(
          paymentId,
          gatewayPayment(paymentId, orderId, amountPaise + 100, "captured")
        );
        const { result } = await reconcile();
        expect((await itemsOf(result.run_id)).map((i) => i.kind)).toEqual(["amount_mismatch"]);
      });

      it("reports a gateway payment that failed while an order exists", async () => {
        const { orderId, amountPaise, paymentId } = await seedPaidOrder();
        script.payments.set(paymentId, gatewayPayment(paymentId, orderId, amountPaise, "failed"));
        const { result } = await reconcile();
        expect((await itemsOf(result.run_id)).map((i) => i.kind)).toEqual(["order_not_captured"]);
      });

      it("reports a refunded amount that differs from the order", async () => {
        const { orderId, amountPaise, paymentId } = await seedPaidOrder();
        script.payments.set(
          paymentId,
          gatewayPayment(paymentId, orderId, amountPaise, "captured", 5000)
        );
        const { result } = await reconcile();
        expect((await itemsOf(result.run_id)).map((i) => i.kind)).toEqual(["refund_mismatch"]);
      });

      it("reports nothing and sends no alert for matching data, but still audits", async () => {
        await seedPaidOrder();
        const { result } = await reconcile();
        expect(result.mismatch_count).toBe(0);
        expect(await itemsOf(result.run_id)).toHaveLength(0);
        await eventually(() => expect(auditPayment).toHaveBeenCalledTimes(1));
        expect(notifyStaff).not.toHaveBeenCalled();
      });

      it("marks a run cut short at 2,000 payments and alerts", async () => {
        script.listOverride = (skip, count) =>
          skip < 2000
            ? Array.from({ length: count }, (_, i) =>
                gatewayPayment(`pay_BULK${skip + i}`, null, 100, "failed")
              )
            : [];
        const { result } = await reconcile();
        expect(result).toMatchObject({ truncated: true, scanned_count: 2000, mismatch_count: 0 });
        await eventually(() => expect(notifyStaff).toHaveBeenCalledTimes(1));
        expect((notifyStaff as jest.Mock).mock.calls[0][1].lines.join(" ")).toContain("cut short");
      });

      it("lists runs newest first and honours the limit", async () => {
        await reconcile(new Date(Date.now() - 1000));
        const second = await reconcile();
        const all = await api.get("/admin/razorpay/reconciliation", { headers });
        expect(all.status).toBe(200);
        expect(all.data.runs[0].id).toBe(second.result.run_id);
        expect(all.data.runs.length).toBeGreaterThanOrEqual(2);
        const one = await api.get("/admin/razorpay/reconciliation?limit=1", { headers });
        expect(one.data.runs).toHaveLength(1);
      });

      it("refuses a bad limit and unknown query keys", async () => {
        expect((await call(() => api.get("/admin/razorpay/reconciliation?limit=0", { headers }))).status).toBe(400);
        expect((await call(() => api.get("/admin/razorpay/reconciliation?limit=51", { headers }))).status).toBe(400);
        expect((await call(() => api.get("/admin/razorpay/reconciliation?x=1", { headers }))).status).toBe(400);
      });

      it("returns a run's items with rupee strings and the refundable flag", async () => {
        await seedOrphan();
        const { result } = await reconcile();
        const detail = await api.get(`/admin/razorpay/reconciliation/${result.run_id}`, { headers });
        expect(detail.status).toBe(200);
        expect(detail.data.run.id).toBe(result.run_id);
        expect(detail.data.items[0]).toMatchObject({
          kind: "captured_no_order",
          amount_inr: "499.00",
          refundable: true,
        });
        expect(JSON.stringify(detail.data)).not.toContain("detail");
      });

      it("answers 404 for an unknown run", async () => {
        const response = await call(() =>
          api.get("/admin/razorpay/reconciliation/rzrr_missing", { headers })
        );
        expect(response.status).toBe(404);
      });

      it("answers 401 without a session", async () => {
        const response = await call(() => api.get("/admin/razorpay/reconciliation"));
        expect(response.status).toBe(401);
      });

      it("refunds an orphan in full once, with the derived key, and refuses a second try", async () => {
        const { amountPaise, paymentId } = await seedOrphan();
        const { result } = await reconcile();
        const [item] = await itemsOf(result.run_id);

        const first = await api.post(
          `/admin/razorpay/reconciliation/items/${item.id}/refund`,
          {},
          { headers }
        );
        expect(first.status).toBe(200);
        expect(first.data.razorpay_refund_id).toMatch(/^rfnd_/);

        const requests = script.refundRequests();
        expect(requests).toHaveLength(1);
        expect(requests[0].path).toBe(`payments/${paymentId}/refund`);
        expect((requests[0].body as { amount: number }).amount).toBe(amountPaise);
        expect(requests[0].headers["x-refund-idempotency"]).toMatch(/^[0-9a-f]{64}$/);

        const second = await call(() =>
          api.post(`/admin/razorpay/reconciliation/items/${item.id}/refund`, {}, { headers })
        );
        expect(second.status).toBe(409);
        expect(script.refundRequests()).toHaveLength(1);

        const detail = await api.get(`/admin/razorpay/reconciliation/${result.run_id}`, { headers });
        expect(detail.data.items[0].resolved_at).toBeTruthy();
        expect(detail.data.items[0].refundable).toBe(false);
      });

      it("refuses a body key on the refund route", async () => {
        await seedOrphan();
        const { result } = await reconcile();
        const [item] = await itemsOf(result.run_id);
        const response = await call(() =>
          api.post(
            `/admin/razorpay/reconciliation/items/${item.id}/refund`,
            { amount: 1 },
            { headers }
          )
        );
        expect(response.status).toBe(400);
        expect(script.refundRequests()).toHaveLength(0);
      });

      it("refuses to refund an item that is not an orphan and an unknown item", async () => {
        const { orderId, amountPaise, paymentId } = await seedPaidOrder();
        script.payments.set(
          paymentId,
          gatewayPayment(paymentId, orderId, amountPaise + 100, "captured")
        );
        const { result } = await reconcile();
        const [item] = await itemsOf(result.run_id);
        const notOrphan = await call(() =>
          api.post(`/admin/razorpay/reconciliation/items/${item.id}/refund`, {}, { headers })
        );
        expect(notOrphan.status).toBe(409);
        const unknown = await call(() =>
          api.post("/admin/razorpay/reconciliation/items/rzri_missing/refund", {}, { headers })
        );
        expect(unknown.status).toBe(404);
        expect(script.refundRequests()).toHaveLength(0);
      });

      (governanceApplied ? it : it.skip)("lets finance read but not refund, and blocks other roles", async () => {
        await seedOrphan();
        const { result } = await reconcile();
        const [item] = await itemsOf(result.run_id);

        const finance = await adminHeadersFor(api, getContainer(), "finance_readonly");
        expect((await api.get("/admin/razorpay/reconciliation", { headers: finance })).status).toBe(200);
        const refund = await call(() =>
          api.post(`/admin/razorpay/reconciliation/items/${item.id}/refund`, {}, { headers: finance })
        );
        expect(refund.status).toBe(403);

        const approver = await adminHeadersFor(api, getContainer(), "catalog_approver");
        expect(
          (await call(() => api.get("/admin/razorpay/reconciliation", { headers: approver }))).status
        ).toBe(403);
        expect(script.refundRequests()).toHaveLength(0);
      });
    });
  },
});
