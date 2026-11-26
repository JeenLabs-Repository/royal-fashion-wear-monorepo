import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  RAZORPAY_LEDGER_MODULE,
  fromPaise,
  signWebhookBody,
  toPaise,
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

const eventually = async (check: () => void | Promise<void>, timeoutMs = 10000): Promise<void> => {
  const started = Date.now();
  for (;;) {
    try {
      await check();
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

const refundEventBody = (
  type: "refund.processed" | "refund.failed",
  refundId: string,
  paymentId: string,
  amountPaise: number
): string =>
  JSON.stringify({
    entity: "event",
    event: type,
    payload: {
      refund: {
        entity: {
          id: refundId,
          entity: "refund",
          amount: amountPaise,
          payment_id: paymentId,
          status: type === "refund.processed" ? "processed" : "failed",
        },
      },
    },
  });

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("razorpay refunds", () => {
      let headers: Record<string, string>;
      // Webhook secret of the card saved by the latest payable cart.
      let secret = "";
      let script: GatewayScript;
      let counter = 0;

      // A paid order of 100.00: the gateway payment and the Medusa payment are both captured.
      const seedPaid = async () => {
        const cart = await createPayableCart(getContainer(), {
          api,
          adminHeaders: headers,
          unitPrice: "100.00",
          shippingPrice: "0.00",
        });
        cart.gateway.payments = [{ status: "captured", amount_rupees: "100.00" }];
        secret = (cart.card as { webhook_secret: string }).webhook_secret;
        const orderId = cart.razorpay_order_id as string;
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
        const gatewayId = `pay_REFD${String(++counter).padStart(8, "0")}`;
        script.payments.set(
          gatewayId,
          gatewayPayment(gatewayId, orderId, Number(paiseOf("100.00")), "captured")
        );
        // <RESOLVE: field names of EventFields. Command:
        // grep -n "export type EventFields" -A6 apps/backend/integration-tests/helpers/razorpay-webhook.ts>
        const posted = await signAndPost(
          api,
          buildEventBody("payment.captured", {
            paymentId: gatewayId,
            razorpayOrderId: orderId,
            sessionId: cart.session_id as string,
            amountPaise: paiseOf("100.00"),
          }),
          { secret, eventId: `evt_${gatewayId}` }
        );
        expect(posted.status).toBe(200);
        await waitForOrder(getContainer(), cart.cart_id);

        const { data: payments } = await query.graph({
          entity: "payment",
          fields: ["id", "amount", "data"],
          filters: { payment_collection_id: cart.payment_collection_id },
        });
        // Authorize stores the id the SDK fake returned (pay_test_*), not the
        // webhook's scripted id. Ledger rows and refund lookups use that stored id.
        const storedGatewayId =
          typeof payments[0]?.data?.razorpay_payment_id === "string"
            ? (payments[0].data.razorpay_payment_id as string)
            : gatewayId;
        if (!script.payments.has(storedGatewayId)) {
          script.payments.set(
            storedGatewayId,
            gatewayPayment(
              storedGatewayId,
              orderId,
              Number(paiseOf("100.00")),
              "captured"
            )
          );
        }
        return {
          gatewayId: storedGatewayId,
          medusaPaymentId: payments[0].id as string,
          totalPaise: toPaise(payments[0].amount),
        };
      };

      // <RESOLVE: refund route body and amount unit (decimal rupees as a number). Command:
      // grep -n "Refund route\|amount unit" docs/decisions/*razorpay-refunds-and-session-states.md>
      const refund = (paymentId: string, paise: number) =>
        call(() =>
          api.post(
            `/admin/payments/${paymentId}/refund`,
            { amount: Number(fromPaise(paise)) },
            { headers }
          )
        );

      const ledgerRows = async (gatewayId: string) => {
        const ledger = getContainer().resolve(RAZORPAY_LEDGER_MODULE) as unknown as {
          listRefundsForPayment(id: string): Promise<{ razorpay_refund_id: string; status: string; amount_paise: number }[]>;
        };
        return ledger.listRefundsForPayment(gatewayId);
      };

      const medusaRefundedPaise = async (medusaPaymentId: string) => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
        const { data } = await query.graph({
          entity: "payment",
          fields: ["id", "refunds.amount"],
          filters: { id: medusaPaymentId },
        });
        return (data[0].refunds ?? []).reduce(
          (sum: number, row: { amount: unknown }) => sum + toPaise(row.amount),
          0
        );
      };

      beforeEach(async () => {
        jest.clearAllMocks();
        script = installGatewayScript();
        headers = await adminHeadersFor(api, getContainer(), "superadmin");
      });

      afterEach(() => script.restore());

      it("sends two partial refunds with different derived keys and the order follows", async () => {
        const { medusaPaymentId } = await seedPaid();
        expect((await refund(medusaPaymentId, 4000)).status).toBe(200);
        expect((await refund(medusaPaymentId, 3000)).status).toBe(200);

        const requests = script.refundRequests();
        expect(requests).toHaveLength(2);
        const [first, second] = requests.map((r) => r.headers["x-refund-idempotency"]);
        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(second).toMatch(/^[0-9a-f]{64}$/);
        expect(first).not.toBe(second);
        expect((requests[0].body as { amount: number }).amount).toBe(4000);
        expect((requests[1].body as { amount: number }).amount).toBe(3000);
        expect(await medusaRefundedPaise(medusaPaymentId)).toBe(7000);
      });

      it("reuses the key when a first attempt was answered with a conflict", async () => {
        const { medusaPaymentId } = await seedPaid();
        script.refundReplies.push({
          status: 409,
          body: { error: { code: "BAD_REQUEST_ERROR", description: "Refund already in progress" } },
        });
        const failed = await refund(medusaPaymentId, 4000);
        expect(failed.status).toBeGreaterThanOrEqual(400);
        const retried = await refund(medusaPaymentId, 4000);
        expect(retried.status).toBe(200);

        const keys = script.refundRequests().map((r) => r.headers["x-refund-idempotency"]);
        expect(keys).toHaveLength(2);
        expect(keys[0]).toBe(keys[1]);
        expect(script.refundsCreated).toHaveLength(1);
      });

      it("refuses a refund above the balance without calling the gateway", async () => {
        const { medusaPaymentId, totalPaise } = await seedPaid();
        expect((await refund(medusaPaymentId, 4000)).status).toBe(200);
        expect((await refund(medusaPaymentId, 3000)).status).toBe(200);
        const before = script.refundRequests().length;
        const over = await refund(medusaPaymentId, totalPaise - 7000 + 100);
        expect(over.status).toBeGreaterThanOrEqual(400);
        expect(script.refundRequests()).toHaveLength(before);
      });

      it("records a ledger row and the audit entry for each refund", async () => {
        const { gatewayId, medusaPaymentId } = await seedPaid();
        await refund(medusaPaymentId, 4000);
        await eventually(async () => {
          const rows = await ledgerRows(gatewayId);
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ amount_paise: 4000, status: "pending" });
        });
        await eventually(() => {
          expect(auditPayment).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: "refund.issued" })
          );
        });
        const input = (auditPayment as jest.Mock).mock.calls.find(
          (c) => c[1].action === "refund.issued"
        )![1];
        expect(input.meta).toMatchObject({ razorpay_payment_id: gatewayId, amount_paise: 4000 });
      });

      it("marks the row processed on a signed refund.processed event and ignores a replay", async () => {
        const { gatewayId, medusaPaymentId } = await seedPaid();
        await refund(medusaPaymentId, 4000);
        const refundId = script.refundsCreated[0].id;
        await eventually(async () => expect(await ledgerRows(gatewayId)).toHaveLength(1));

        const raw = refundEventBody("refund.processed", refundId, gatewayId, 4000);
        const posted = await signAndPost(api, raw, {
          secret: secret,
          eventId: "evt_refund_processed_1",
        });
        expect(posted.status).toBe(200);
        await eventually(async () => {
          expect((await ledgerRows(gatewayId))[0].status).toBe("processed");
        });

        const replay = await signAndPost(api, raw, {
          secret: secret,
          eventId: "evt_refund_processed_1",
        });
        expect(replay.status).toBe(200);
        expect(replay.body).toMatchObject({ duplicate: true });
        const rows = await ledgerRows(gatewayId);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe("processed");
      });

      it("raises exactly one alert for a signed refund.failed event", async () => {
        const { gatewayId, medusaPaymentId } = await seedPaid();
        await refund(medusaPaymentId, 4000);
        const refundId = script.refundsCreated[0].id;
        await eventually(async () => expect(await ledgerRows(gatewayId)).toHaveLength(1));

        const raw = refundEventBody("refund.failed", refundId, gatewayId, 4000);
        const options = { secret: secret, eventId: "evt_refund_failed_1" };
        expect((await signAndPost(api, raw, options)).status).toBe(200);
        expect((await signAndPost(api, raw, options)).status).toBe(200);

        await eventually(() => {
          const alerts = (notifyStaff as jest.Mock).mock.calls.filter(
            (c) => c[1].kind === "refund-failed"
          );
          expect(alerts).toHaveLength(1);
          expect(alerts[0][1].idempotencyKey).toBe(`refund-failed:${refundId}:once`);
        });
      });

      it("rejects a refund event with a wrong signature and changes nothing", async () => {
        const { gatewayId, medusaPaymentId } = await seedPaid();
        await refund(medusaPaymentId, 4000);
        const refundId = script.refundsCreated[0].id;
        await eventually(async () => expect(await ledgerRows(gatewayId)).toHaveLength(1));

        const raw = refundEventBody("refund.processed", refundId, gatewayId, 4000);
        const posted = await signAndPost(api, raw, {
          secret: secret,
          eventId: "evt_refund_bad_sig",
          signatureOverride: signWebhookBody(raw, "not-the-secret"),
        });
        expect(posted.status).toBe(400);
        expect((await ledgerRows(gatewayId))[0].status).toBe("pending");
      });

      it("lists the refund rows with statuses and rupee strings", async () => {
        const { medusaPaymentId } = await seedPaid();
        await refund(medusaPaymentId, 4000);
        await refund(medusaPaymentId, 3000);
        await eventually(async () => {
          const response = await api.get(`/admin/razorpay/refunds?payment_id=${medusaPaymentId}`, {
            headers,
          });
          expect(response.status).toBe(200);
          expect(response.data.refunds).toHaveLength(2);
        });
        const response = await api.get(`/admin/razorpay/refunds?payment_id=${medusaPaymentId}`, {
          headers,
        });
        const amounts = response.data.refunds.map((r: { amount_inr: string }) => r.amount_inr).sort();
        expect(amounts).toEqual(["30.00", "40.00"]);
        expect(response.data.refunds[0].status).toBe("pending");
        expect(JSON.stringify(response.data)).not.toMatch(/[0-9a-f]{64}/);
      });

      it("returns an empty list for a payment with no refunds", async () => {
        const { medusaPaymentId } = await seedPaid();
        const response = await api.get(`/admin/razorpay/refunds?payment_id=${medusaPaymentId}`, {
          headers,
        });
        expect(response.data).toEqual({ refunds: [] });
      });

      it("validates the refund status query", async () => {
        expect((await call(() => api.get("/admin/razorpay/refunds", { headers }))).status).toBe(400);
        expect(
          (await call(() => api.get("/admin/razorpay/refunds?payment_id=pay_x&extra=1", { headers })))
            .status
        ).toBe(400);
        expect(
          (await call(() => api.get("/admin/razorpay/refunds?payment_id=pay_missing", { headers })))
            .status
        ).toBe(404);
        expect((await call(() => api.get("/admin/razorpay/refunds?payment_id=pay_x"))).status).toBe(401);
      });
    });
  },
});
