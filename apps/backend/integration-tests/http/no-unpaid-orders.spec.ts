import fs from "fs";
import path from "path";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createRegionsWorkflow } from "@medusajs/medusa/core-flows";
import { RAZORPAY_PAYMENT_PROVIDER_ID, seedIndiaCommerce } from "../../src/lib/commerce/india-seed";
import { adminHeadersFor } from "../helpers/admin-as";
import { createPayableCart, resetFakeGateway } from "../helpers/payable-cart";

jest.setTimeout(180 * 1000);

const SYSTEM_PROVIDER = "pp_system_default";
const FORBIDDEN_IDS = ["pp_system_default", "pp_stripe", "pp_paypal"];

const readFilesUnder = (root: string): { file: string; text: string }[] => {
  const found: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          walk(full);
        }
      } else if (/\.(ts|tsx|js|json)$/.test(entry.name)) {
        found.push({ file: full, text: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return found;
};

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer, api }) => {
    afterEach(() => resetFakeGateway());

    const query = () =>
      getContainer().resolve(ContainerRegistrationKeys.QUERY) as unknown as {
        graph(config: Record<string, unknown>): Promise<{ data: any[] }>;
      };

    const orderCount = async () => (await query().graph({ entity: "order", fields: ["id"] })).data.length;

    /** Never throws. type is order only when the platform created an order. */
    const tryComplete = async (publishableKey: string, cartId: string) => {
      try {
        const response = await api.post(
          `/store/carts/${cartId}/complete`,
          {},
          { headers: { "x-publishable-api-key": publishableKey } }
        );
        return { status: response.status, type: response.data.type as string, body: response.data };
      } catch (error: any) {
        return {
          status: error.response?.status ?? 0,
          type: "error",
          body: error.response?.data ?? String(error?.message ?? error),
        };
      }
    };

    const sessionStatus = async (sessionId: string) =>
      (await query().graph({ entity: "payment_session", fields: ["id", "status"], filters: { id: sessionId } }))
        .data[0]?.status;

    const admin = () => adminHeadersFor(api, getContainer(), "superadmin");

    describe("no order without a captured payment", () => {
      it("lists only the Razorpay provider for the India region", async () => {
        const cart = await createPayableCart(getContainer(), { api, payment: false });
        const response = await api.get(`/store/payment-providers?region_id=${cart.region_id}`, {
          headers: { "x-publishable-api-key": cart.publishable_key },
        });
        const ids = response.data.payment_providers.map((p: { id: string }) => p.id);
        expect(ids).toHaveLength(1);
        expect(ids).toEqual([RAZORPAY_PAYMENT_PROVIDER_ID]);
      });

      it("shows one provider on the admin region read", async () => {
        const cart = await createPayableCart(getContainer(), { api, payment: false });
        const response = await api.get(
          `/admin/regions/${cart.region_id}?fields=id,*payment_providers`,
          { headers: await admin() }
        );
        expect(response.data.region.payment_providers.map((p: { id: string }) => p.id)).toEqual([
          RAZORPAY_PAYMENT_PROVIDER_ID,
        ]);
      });

      it("refuses a cart that has no payment collection", async () => {
        const cart = await createPayableCart(getContainer(), { api, payment: false });
        const before = await orderCount();
        const outcome = await tryComplete(cart.publishable_key, cart.cart_id);
        expect(outcome.type).not.toBe("order");
        expect(await orderCount()).toBe(before);
      });

      it("refuses a pending Razorpay session when the gateway reports no payment", async () => {
        const cart = await createPayableCart(getContainer(), { api, adminHeaders: await admin() });
        const before = await orderCount();
        const outcome = await tryComplete(cart.publishable_key, cart.cart_id);
        expect(outcome.type).not.toBe("order");
        expect(await orderCount()).toBe(before);
        expect(await sessionStatus(cart.session_id as string)).not.toBe("authorized");
      });

      it("refuses a session whose only gateway payment failed", async () => {
        const cart = await createPayableCart(getContainer(), { api, adminHeaders: await admin() });
        cart.gateway.payments = [{ status: "failed", amount_rupees: "118.00" }];
        const before = await orderCount();
        const outcome = await tryComplete(cart.publishable_key, cart.cart_id);
        expect(outcome.type).not.toBe("order");
        expect(await orderCount()).toBe(before);
      });

      it("refuses a captured payment of a different amount", async () => {
        const cart = await createPayableCart(getContainer(), { api, adminHeaders: await admin() });
        cart.gateway.payments = [{ status: "captured", amount_rupees: "117.00" }];
        const before = await orderCount();
        const outcome = await tryComplete(cart.publishable_key, cart.cart_id);
        expect(outcome.type).not.toBe("order");
        expect(await orderCount()).toBe(before);
      });

      it("refuses to open a session with the system provider on the India region", async () => {
        const cart = await createPayableCart(getContainer(), { api, payment: false });
        const headers = { headers: { "x-publishable-api-key": cart.publishable_key } };
        const collection = await api.post("/store/payment-collections", { cart_id: cart.cart_id }, headers);
        const attempt = await api
          .post(
            `/store/payment-collections/${collection.data.payment_collection.id}/payment-sessions`,
            { provider_id: SYSTEM_PROVIDER },
            headers
          )
          .then(
            (response) => ({ status: response.status }),
            (error: any) => ({ status: error.response?.status ?? 0 })
          );
        expect(attempt.status).toBeGreaterThanOrEqual(400);
      });

      it("keeps a zero total cart from completing", async () => {
        const cart = await createPayableCart(getContainer(), {
          api,
          productType: "GST-18",
          unitPrice: "0.00",
          shippingPrice: "0.00",
          payment: false,
        });
        const headers = { headers: { "x-publishable-api-key": cart.publishable_key } };
        const before = await orderCount();
        const collection = await api
          .post("/store/payment-collections", { cart_id: cart.cart_id }, headers)
          .catch((error: any) => ({ data: null, status: error.response?.status ?? 0 }));
        if (collection.data) {
          // The Razorpay provider refuses an amount under one rupee, so no session opens.
          const attempt = await api
            .post(
              `/store/payment-collections/${collection.data.payment_collection.id}/payment-sessions`,
              { provider_id: RAZORPAY_PAYMENT_PROVIDER_ID },
              headers
            )
            .then(
              (response) => ({ status: response.status }),
              (error: any) => ({ status: error.response?.status ?? 0 })
            );
          expect(attempt.status).toBeGreaterThanOrEqual(400);
        }
        const outcome = await tryComplete(cart.publishable_key, cart.cart_id);
        // If the platform completes a zero total cart, that is an unpaid order path: fix the
        // seed or configuration instead of relaxing this assertion.
        expect(outcome.type).not.toBe("order");
        expect(await orderCount()).toBe(before);
      });

      it("leaves a region seeded for another country without providers", async () => {
        const container = getContainer();
        await createPayableCart(container, { api, payment: false });
        await createRegionsWorkflow(container).run({
          input: {
            regions: [
              {
                name: "Throwaway",
                currency_code: "inr",
                countries: ["us"],
                payment_providers: [RAZORPAY_PAYMENT_PROVIDER_ID],
              },
            ],
          },
        });
        await seedIndiaCommerce(container);
        const { data } = await query().graph({
          entity: "region",
          fields: ["name", "payment_providers.id"],
          filters: { name: "Throwaway" },
        });
        expect(data[0].payment_providers).toEqual([]);
      });

      it("names no system, Stripe or PayPal provider in the application source or configuration", () => {
        const roots = [path.join(process.cwd(), "src"), path.join(process.cwd(), "medusa-config.ts")];
        const files = roots.flatMap((root) =>
          fs.statSync(root).isDirectory()
            ? readFilesUnder(root)
            : [{ file: root, text: fs.readFileSync(root, "utf8") }]
        );
        const offenders = files
          .filter(({ text }) => FORBIDDEN_IDS.some((id) => text.includes(id)))
          .map(({ file }) => path.relative(process.cwd(), file));
        expect(offenders).toEqual([]);
      });
    });
  },
});