import crypto from "crypto";
import fs from "fs";
import path from "path";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";
import { updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows";
import { RAZORPAY_EVENTS, signWebhookBody } from "@jeenlabs-repository/medusa-payment-razorpay/public";
import { notifyStaff } from "../../src/lib/payments/staff-hooks";
import { adminHeadersFor } from "../helpers/admin-as";
import {
  clearRazorpayCard,
  createPayableCart,
  paiseOf,
  resetFakeGateway,
} from "../helpers/payable-cart";
import type { PayableCart } from "../helpers/payable-cart";
import {
  buildEventBody,
  buildSpacedEventBody,
  countOrders,
  ledgerRows,
  ordersForCart,
  placeOrderViaStore,
  settle,
  signAndPost,
  waitForOrder,
  waitUntil,
} from "../helpers/razorpay-webhook";

// Staff alerts are checked through the adapter, so the real mail path is not touched.
jest.mock("../../src/lib/payments/staff-hooks", () => ({
  ...jest.requireActual("../../src/lib/payments/staff-hooks"),
  notifyStaff: jest.fn(async () => true),
}));

jest.setTimeout(240 * 1000);

// Which branch of the completion question applies: the workflow file exists only when needed.
const WORKFLOW_BRANCH = fs.existsSync(
  path.join(process.cwd(), "src/workflows/complete-cart-from-payment.ts")
);
// <RESOLVE: the status an order payment holds after a capture, from the completion record. Command:
// grep -n "creates and captures" docs/decisions/*razorpay-webhook-and-order-completion.md>
const ACCEPTED_ORDER_PAYMENT_STATUSES = ["captured"];
// <RESOLVE: the status the guard answers for an unknown session, from the session-state record. Command:
// grep -n "status the guard must return" docs/decisions/*razorpay-refunds-and-session-states.md>
const UNKNOWN_SESSION_STATUS = 200;

const AMOUNT = "118.00";
const newEventId = () => `evt_${crypto.randomBytes(8).toString("hex")}`;

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer, api }) => {
    const notify = notifyStaff as unknown as jest.Mock;
    let emitSpy: jest.SpyInstance;

    beforeEach(() => {
      notify.mockClear();
      emitSpy = jest.spyOn(getContainer().resolve(Modules.EVENT_BUS) as any, "emit");
    });

    afterEach(() => {
      emitSpy.mockRestore();
      resetFakeGateway();
    });

    const paidCart = async (): Promise<PayableCart> => {
      const cart = await createPayableCart(getContainer(), {
        api,
        adminHeaders: await adminHeadersFor(api, getContainer(), "superadmin"),
      });
      cart.gateway.payments = [{ status: "captured", amount_rupees: AMOUNT }];
      return cart;
    };

    const fieldsOf = (cart: PayableCart, paymentId = "pay_test_1") => ({
      paymentId,
      razorpayOrderId: cart.razorpay_order_id as string,
      sessionId: cart.session_id as string,
      amountPaise: paiseOf(AMOUNT),
    });

    const secretOf = (cart: PayableCart) => (cart.card as { webhook_secret: string }).webhook_secret;

    const orphanEmitted = (eventId?: string) =>
      emitSpy.mock.calls.some(([message]) => {
        const first = Array.isArray(message) ? message[0] : message;
        return (
          first?.name === RAZORPAY_EVENTS.paymentOrphan &&
          (eventId === undefined || first?.data?.event_id === eventId || first?.data?.reason)
        );
      });

    // The completion workflow and the later alert subscriber share one idempotency key, so the
    // adapter may be called more than once for one orphan but only ever with that key.
    const expectOneOrphanAlertKey = (cart: PayableCart) => {
      expect(notify).toHaveBeenCalled();
      const keys = new Set(
        notify.mock.calls.map(([, input]) => (input as { idempotencyKey: string }).idempotencyKey)
      );
      expect(keys).toEqual(new Set([`payment-orphan:${cart.session_id}:once`]));
    };

    describe("signed webhooks", () => {
      it("creates one order from a signed capture with no browser call", async () => {
        const cart = await paidCart();
        const eventId = newEventId();
        const result = await signAndPost(api, buildEventBody("payment.captured", fieldsOf(cart)), {
          secret: secretOf(cart),
          eventId,
        });
        expect(result.status).toBe(200);
        const orders = await waitForOrder(getContainer(), cart.cart_id);
        expect(orders).toHaveLength(1);
      });

      it("leaves the order payment in the recorded state", async () => {
        const cart = await paidCart();
        await signAndPost(api, buildEventBody("payment.captured", fieldsOf(cart)), {
          secret: secretOf(cart),
          eventId: newEventId(),
        });
        const [orderId] = await waitForOrder(getContainer(), cart.cart_id);
        const response = await api.get(`/admin/orders/${orderId}?fields=id,payment_status`, {
          headers: await adminHeadersFor(api, getContainer(), "superadmin"),
        });
        expect(ACCEPTED_ORDER_PAYMENT_STATUSES).toContain(response.data.order.payment_status);
      });

      it("acknowledges a replay as a duplicate and keeps one order", async () => {
        const cart = await paidCart();
        const eventId = newEventId();
        const body = buildEventBody("payment.captured", fieldsOf(cart));
        await signAndPost(api, body, { secret: secretOf(cart), eventId });
        await waitForOrder(getContainer(), cart.cart_id);
        const replay = await signAndPost(api, body, { secret: secretOf(cart), eventId });
        expect(replay.status).toBe(200);
        expect(replay.body.duplicate).toBe(true);
        expect(await ordersForCart(getContainer(), cart.cart_id)).toHaveLength(1);
      });

      it("records the processed event once", async () => {
        const cart = await paidCart();
        const eventId = newEventId();
        const body = buildEventBody("payment.captured", fieldsOf(cart));
        await signAndPost(api, body, { secret: secretOf(cart), eventId });
        await waitForOrder(getContainer(), cart.cart_id);
        await signAndPost(api, body, { secret: secretOf(cart), eventId });
        const rows = await ledgerRows(getContainer(), eventId);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe("processed");
        expect(rows[0].attempts).toBe(1);
      });

      it("rejects a signature made with the wrong secret and writes no ledger row", async () => {
        const cart = await paidCart();
        const eventId = newEventId();
        const result = await signAndPost(api, buildEventBody("payment.captured", fieldsOf(cart)), {
          secret: "not-the-secret",
          eventId,
        });
        expect(result.status).toBe(400);
        expect(await ledgerRows(getContainer(), eventId)).toHaveLength(0);
        expect(await ordersForCart(getContainer(), cart.cart_id)).toHaveLength(0);
      });

      it("rejects a body changed by one character after signing", async () => {
        const cart = await paidCart();
        const eventId = newEventId();
        const body = buildEventBody("payment.captured", fieldsOf(cart));
        const signature = signWebhookBody(body, secretOf(cart));
        const altered = body.replace("INR", "INS");
        const result = await signAndPost(api, altered, {
          secret: secretOf(cart),
          eventId,
          signatureOverride: signature,
        });
        expect(result.status).toBe(400);
        expect(await ledgerRows(getContainer(), eventId)).toHaveLength(0);
      });

      it("rejects a request with no signature header", async () => {
        const cart = await paidCart();
        const eventId = newEventId();
        const result = await signAndPost(api, buildEventBody("payment.captured", fieldsOf(cart)), {
          secret: secretOf(cart),
          eventId,
          omitSignature: true,
        });
        expect(result.status).toBe(400);
        expect(await ledgerRows(getContainer(), eventId)).toHaveLength(0);
      });

      it("rejects a body signed over its compact form when the bytes sent differ", async () => {
        const cart = await paidCart();
        const eventId = newEventId();
        const compactSignature = signWebhookBody(
          buildEventBody("payment.captured", fieldsOf(cart)),
          secretOf(cart)
        );
        const result = await signAndPost(
          api,
          buildSpacedEventBody("payment.captured", fieldsOf(cart)),
          { secret: secretOf(cart), eventId, signatureOverride: compactSignature }
        );
        expect(result.status).toBe(400);
        expect(await ordersForCart(getContainer(), cart.cart_id)).toHaveLength(0);
      });

      it("accepts irregular spacing when the signature covers those bytes", async () => {
        const cart = await paidCart();
        const result = await signAndPost(
          api,
          buildSpacedEventBody("payment.captured", fieldsOf(cart)),
          { secret: secretOf(cart), eventId: newEventId() }
        );
        expect(result.status).toBe(200);
        expect(await waitForOrder(getContainer(), cart.cart_id)).toHaveLength(1);
      });

      it("answers 503 and writes no ledger row when no card is saved", async () => {
        const admin = await adminHeadersFor(api, getContainer(), "superadmin");
        await clearRazorpayCard(api, admin);
        const bare = await createPayableCart(getContainer(), { api, payment: false });
        const eventId = newEventId();
        const result = await signAndPost(
          api,
          buildEventBody("payment.captured", {
            paymentId: "pay_test_1",
            razorpayOrderId: "order_none",
            sessionId: "payses_none",
            amountPaise: paiseOf(AMOUNT),
          }),
          { secret: "no-card-secret", eventId }
        );
        expect(bare.card).toBeNull();
        expect(result.status).toBe(503);
        expect(await ledgerRows(getContainer(), eventId)).toHaveLength(0);
      });

      it("handles a gateway failure on the first delivery", async () => {
        const cart = await paidCart();
        const eventId = newEventId();
        const body = buildEventBody("payment.captured", fieldsOf(cart));
        cart.gateway.failLookups = true;
        const first = await signAndPost(api, body, { secret: secretOf(cart), eventId });

        if (WORKFLOW_BRANCH) {
          // The delivery was acknowledged, so the failure ends as an orphan with an alert.
          expect(first.status).toBe(200);
          expect(await waitUntil(() => orphanEmitted())).toBe(true);
          expectOneOrphanAlertKey(cart);
          expect(await ordersForCart(getContainer(), cart.cart_id)).toHaveLength(0);
          return;
        }

        // Core acknowledges immediately (HTTP 200) and processes later. A gateway
        // outage during authorize leaves no order; the same event id is then a
        // duplicate, so a fresh event after recovery creates the order.
        expect(first.status).toBe(200);
        await settle(7000);
        expect(await ordersForCart(getContainer(), cart.cart_id)).toHaveLength(0);
        expect((await ledgerRows(getContainer(), eventId))[0].status).toBe("processed");
        cart.gateway.failLookups = false;
        const replay = await signAndPost(api, body, { secret: secretOf(cart), eventId });
        expect(replay.status).toBe(200);
        expect(replay.body.duplicate).toBe(true);
        const recoveryId = newEventId();
        const second = await signAndPost(api, body, {
          secret: secretOf(cart),
          eventId: recoveryId,
        });
        expect(second.status).toBe(200);
        expect(await waitForOrder(getContainer(), cart.cart_id)).toHaveLength(1);
        expect((await ledgerRows(getContainer(), recoveryId))[0].status).toBe("processed");
      });
    });

    describe("ordering noise", () => {
      it("ignores a failed payment event after a processed capture", async () => {
        const cart = await paidCart();
        await signAndPost(api, buildEventBody("payment.captured", fieldsOf(cart)), {
          secret: secretOf(cart),
          eventId: newEventId(),
        });
        await waitForOrder(getContainer(), cart.cart_id);
        const late = await signAndPost(
          api,
          buildEventBody("payment.failed", fieldsOf(cart, "pay_test_2")),
          { secret: secretOf(cart), eventId: newEventId() }
        );
        expect(late.status).toBe(200);
        await settle();
        expect(await ordersForCart(getContainer(), cart.cart_id)).toHaveLength(1);
      });

      it("ignores an order paid event after a processed capture", async () => {
        const cart = await paidCart();
        await signAndPost(api, buildEventBody("payment.captured", fieldsOf(cart)), {
          secret: secretOf(cart),
          eventId: newEventId(),
        });
        await waitForOrder(getContainer(), cart.cart_id);
        const late = await signAndPost(api, buildEventBody("order.paid", fieldsOf(cart)), {
          secret: secretOf(cart),
          eventId: newEventId(),
        });
        expect(late.status).toBe(200);
        await settle();
        expect(await ordersForCart(getContainer(), cart.cart_id)).toHaveLength(1);
      });

      it("creates the order from an order paid event on a pending session", async () => {
        const cart = await paidCart();
        const result = await signAndPost(api, buildEventBody("order.paid", fieldsOf(cart)), {
          secret: secretOf(cart),
          eventId: newEventId(),
        });
        expect(result.status).toBe(200);
        expect(await waitForOrder(getContainer(), cart.cart_id)).toHaveLength(1);
      });

      it("acknowledges an unknown session, creates no order and surfaces it", async () => {
        const cart = await paidCart();
        const eventId = newEventId();
        const before = await countOrders(getContainer());
        const result = await signAndPost(
          api,
          buildEventBody("payment.captured", {
            paymentId: "pay_unknown_1",
            razorpayOrderId: "order_unknown_1",
            sessionId: "payses_unknown",
            amountPaise: paiseOf(AMOUNT),
          }),
          { secret: secretOf(cart), eventId }
        );
        expect(result.status).toBe(UNKNOWN_SESSION_STATUS);
        await settle();
        expect(await countOrders(getContainer())).toBe(before);
        expect(orphanEmitted(eventId)).toBe(true);
      });
    });

    describe("completion failures", () => {
      it("leaves no order when stock is gone and surfaces the payment", async () => {
        const cart = await paidCart();
        await updateInventoryLevelsWorkflow(getContainer()).run({
          input: {
            updates: [
              {
                inventory_item_id: cart.inventory_item_ids[0],
                location_id: cart.stock_location_id,
                stocked_quantity: 0,
              },
            ],
          },
        });
        const eventId = newEventId();
        const body = buildEventBody("payment.captured", fieldsOf(cart));
        const first = await signAndPost(api, body, { secret: secretOf(cart), eventId });

        if (WORKFLOW_BRANCH) {
          expect(first.status).toBe(200);
          expect(await waitUntil(() => orphanEmitted())).toBe(true);
          expectOneOrphanAlertKey(cart);
          expect(await ordersForCart(getContainer(), cart.cart_id)).toHaveLength(0);
          return;
        }

        // Core returns 200 before cart completion. Completion failures are
        // permanent-failure-tolerant, so the ledger is processed; a restocked
        // cart needs a new event id because the first claim already finished.
        expect(first.status).toBe(200);
        await settle(7000);
        expect(await ordersForCart(getContainer(), cart.cart_id)).toHaveLength(0);
        expect((await ledgerRows(getContainer(), eventId))[0].status).toBe("processed");
        await updateInventoryLevelsWorkflow(getContainer()).run({
          input: {
            updates: [
              {
                inventory_item_id: cart.inventory_item_ids[0],
                location_id: cart.stock_location_id,
                stocked_quantity: 100,
              },
            ],
          },
        });
        const retry = await signAndPost(api, body, {
          secret: secretOf(cart),
          eventId: newEventId(),
        });
        expect(retry.status).toBe(200);
        expect(await waitForOrder(getContainer(), cart.cart_id)).toHaveLength(1);
      });
    });

    describe("browser and webhook racing", () => {
      it("creates one order when both paths run together", async () => {
        const cart = await paidCart();
        const [browser, hook] = await Promise.all([
          placeOrderViaStore(api, cart.publishable_key, cart.cart_id),
          signAndPost(api, buildEventBody("payment.captured", fieldsOf(cart)), {
            secret: secretOf(cart),
            eventId: newEventId(),
          }),
        ]);
        expect(hook.status).toBeLessThan(600);
        expect(browser.status).toBeLessThan(600);
        await waitForOrder(getContainer(), cart.cart_id);
        await settle();
        expect(await ordersForCart(getContainer(), cart.cart_id)).toHaveLength(1);
      });
    });
  },
});