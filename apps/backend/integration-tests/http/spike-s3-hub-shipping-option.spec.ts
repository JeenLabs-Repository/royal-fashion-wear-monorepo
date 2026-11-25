import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  assertMedusaVersion,
  buildSpikeFixture,
  completeCart,
  fulfilOrder,
  listReservations,
  observe,
  openCart,
  PROVINCE_B,
  recordSpike,
  shipFulfilment,
  type SpikeLayout,
} from "../support/spike-fixtures";

jest.setTimeout(15 * 60 * 1000);

const LAYOUTS: SpikeLayout[] = ["hub-only", "per-location"];
const STANDARD = "Standard Delivery";

medusaIntegrationTestRunner({
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("hub shipping option", () => {
      it("runs on the pinned Medusa version", () => {
        const version = assertMedusaVersion();
        recordSpike("S3", "setup", "version", { version });
        expect(version).toBe("2.22.7");
      });

      describe.each(LAYOUTS)("layout %s", (layout) => {
        it("records which shipping options a cart is offered and whether fulfilment works", async () => {
          const container = getContainer();
          const build = (stocks: { a: number; b: number }, hubInChannel = true) =>
            buildSpikeFixture(container, api, { layout, stocks, hubInChannel });

          // Step 3a: stock at one vendor location only, both ways round.
          const offered: Record<string, number> = {};
          for (const [name, stocks] of [
            ["stock-only-at-A", { a: 5, b: 0 }],
            ["stock-only-at-B", { a: 0, b: 5 }],
          ] as const) {
            await observe("S3", layout, `3a-${name}`, async () => {
              const f = await build(stocks);
              const opened = await openCart(f, { quantity: 1, province: PROVINCE_B });
              offered[name] = opened.shippingOptions.filter((o) => o.name === STANDARD).length;
              return {
                option_names: opened.shippingOptions.map((o) => o.name),
                option_count: opened.shippingOptions.length,
                standard_delivery_count: offered[name],
                error: opened.error ?? null,
              };
            });
          }

          // Step 3b: complete with the offered option, fulfil at the vendor location holding stock.
          let fulfilOk = false;
          await observe("S3", layout, "3b-fulfil-at-vendor-location", async () => {
            const f = await build({ a: 5, b: 0 });
            const done = await completeCart(f, { quantity: 1, province: PROVINCE_B });
            const fulfilled = await fulfilOrder(f, {
              orderId: done.orderId!,
              lineItemId: done.lineItemId!,
              quantity: 1,
              locationId: f.locationIds.A,
            });
            const fulfillmentId = (fulfilled.result as { id?: string } | undefined)?.id;
            const shipped = fulfillmentId
              ? await shipFulfilment(f, {
                  orderId: done.orderId!,
                  fulfillmentId,
                  lineItemId: done.lineItemId!,
                  quantity: 1,
                })
              : { ok: false, error: "no fulfilment id returned" };
            fulfilOk = fulfilled.ok && shipped.ok;
            return {
              complete_error: done.error ?? null,
              reservation: (await listReservations(f)).map((r) => r.location),
              fulfil_ok: fulfilled.ok,
              fulfil_error: fulfilled.error ?? null,
              ship_ok: shipped.ok,
              ship_error: shipped.error ?? null,
            };
          });

          // Step 3c: the same offer check with the hub outside the sales channel.
          await observe("S3", layout, "3c-hub-not-in-channel", async () => {
            const f = await build({ a: 5, b: 0 }, false);
            const opened = await openCart(f, { quantity: 1, province: PROVINCE_B });
            return {
              option_names: opened.shippingOptions.map((o) => o.name),
              option_count: opened.shippingOptions.length,
              error: opened.error ?? null,
            };
          });

          const optionsOk =
            (offered["stock-only-at-A"] ?? 0) >= 1 && (offered["stock-only-at-B"] ?? 0) >= 1;
          recordSpike("S3", layout, "derived", {
            S3_options_ok: optionsOk,
            S3_fulfil_ok: fulfilOk,
            ...(layout === "per-location" ? { S3_control_ok: optionsOk && fulfilOk } : {}),
          });
        });
      });
    });
  },
});
