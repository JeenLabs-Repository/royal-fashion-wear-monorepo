import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { updateShippingOptionsWorkflow } from "@medusajs/medusa/core-flows";
import {
  ensureHubLocation,
  readHubEnvironment,
  readShippingOptionPriceInr,
  type HubAddress,
} from "../../src/lib/hub/ensure-hub-location";
import { ensureBareDefaults, ensureStoreAndDefaultChannel } from "../support/spike-fixtures";

jest.setTimeout(120 * 1000);

const address: HubAddress = {
  addressLine1: "1 Demo Hub Road",
  city: "Mumbai",
  provinceCode: "IN-MH",
  postalCode: "400001",
};

medusaIntegrationTestRunner({
  env: {},
  testSuite: ({ getContainer }) => {
    describe("hub stock location", () => {
      beforeEach(async () => {
        await ensureStoreAndDefaultChannel(getContainer());
        // The seed data normally creates the shipping profile. A bare test database has none.
        await ensureBareDefaults(getContainer());
      });

      it("creates the hub once and finds it again", async () => {
        const container = getContainer();
        const first = await ensureHubLocation(container, { address });
        const second = await ensureHubLocation(container, { address });

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.stockLocationId).toBe(first.stockLocationId);
        expect(second.shippingOptionId).toBe(first.shippingOptionId);

        const { data: locations } = await container
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({ entity: "stock_location", fields: ["id", "name"], filters: { name: "HUB" } });
        expect(locations).toHaveLength(1);

        const fulfillment = container.resolve(Modules.FULFILLMENT) as any;
        expect(await fulfillment.listFulfillmentSets({ name: "HUB shipping" })).toHaveLength(1);
        expect(await fulfillment.listShippingOptions({ name: "Standard Delivery" })).toHaveLength(1);
      });

      it("prices the option at 0 INR and keeps an edited price on the next run", async () => {
        const container = getContainer();
        const hub = await ensureHubLocation(container, { address });
        expect(await readShippingOptionPriceInr(container, hub.shippingOptionId!)).toBe(0);

        await updateShippingOptionsWorkflow(container).run({
          input: [
            {
              id: hub.shippingOptionId!,
              prices: [{ currency_code: "inr", amount: 49 }],
            },
          ],
        });
        await ensureHubLocation(container, { address, shippingPriceInr: 0 });

        expect(await readShippingOptionPriceInr(container, hub.shippingOptionId!)).toBe(49);
      });

      it("refuses an incomplete address in production and names each missing variable", () => {
        const result = readHubEnvironment({ NODE_ENV: "production", HUB_CITY: "Pune" });
        expect(result.problems).toEqual(
          expect.arrayContaining([
            "HUB_ADDRESS_LINE1 is missing",
            "HUB_STATE_CODE is missing",
            "HUB_PIN is missing",
          ])
        );
        expect(result.problems.join(" ")).not.toContain("HUB_CITY");
      });

      it("falls back to fake values outside production and rejects a bad PIN or price", () => {
        const dev = readHubEnvironment({ NODE_ENV: "development" });
        expect(dev.problems).toEqual([]);
        expect(dev.address.addressLine1).toBe("1 Demo Hub Road");
        expect(dev.shippingPriceInr).toBe(0);

        const bad = readHubEnvironment({
          NODE_ENV: "development",
          HUB_PIN: "012345",
          HUB_SHIPPING_PRICE_INR: "-5",
        });
        expect(bad.problems.length).toBe(2);
      });
    });
  },
});
