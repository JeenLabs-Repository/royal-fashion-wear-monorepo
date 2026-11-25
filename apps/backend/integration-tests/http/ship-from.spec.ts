import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import { getDefaultSalesChannelId } from "../../src/lib/catalog/default-sales-channel";
import { clearShipFromCache, getShipFromStates, shipFromCacheSize, shipFromStateForStockLocation } from "../../src/lib/ship-from";
import { formatShipFromLabel } from "../../src/lib/ship-from/label";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { createPublishableKey } from "../helpers/publishable-key";
import { createCategory, createDraftFor, queryOf, storeGet } from "../support/catalog-fixtures";
import {
  liveProduct,
  stockLocationOf,
  stockProduct,
  unlinkLocationFromChannel,
  vendorInStates,
} from "../support/ship-from-fixtures";

jest.setTimeout(180 * 1000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("GET /store/ship-from", () => {
      let key = "";
      let categoryId = "";
      let counter = 0;
      const suffix = () => `sf${Date.now().toString(36)}${(counter += 1)}`;

      beforeEach(async () => {
        const container = getContainer();
        key = await createPublishableKey(container);
        categoryId = await createCategory(container);
        clearShipFromCache();
      });

      const ask = (ids: string[]) => storeGet(api, key, `/store/ship-from?product_ids=${ids.join(",")}`);

      it("lists the states of two vendors sorted by name with only code and name", async () => {
        const container = getContainer();
        const a = await vendorInStates(api, container, ["IN-MH"]);
        const b = await vendorInStates(api, container, ["IN-TN"]);
        const p1 = await liveProduct(api, container, a, categoryId, [{ locationId: stockLocationOf(a, "IN-MH"), quantity: 5 }], suffix());
        await stockProduct(container, p1.productId, [{ locationId: stockLocationOf(b, "IN-TN"), quantity: 3 }]);

        const response = await ask([p1.productId]);
        expect(response.status).toBe(200);
        const entry = response.data.ship_from.find((item: any) => item.product_id === p1.productId);
        expect(entry.states.map((state: any) => state.name)).toEqual(["Maharashtra", "Tamil Nadu"]);
        for (const state of entry.states) {
          expect(Object.keys(state).sort()).toEqual(["code", "name"]);
        }
        const names = entry.states.map((state: any) => state.name);
        expect(names).toEqual([...names].sort((x: string, y: string) => x.localeCompare(y)));
      });

      it("omits products with no available stock", async () => {
        const container = getContainer();
        const vendor = await vendorInStates(api, container, ["IN-MH"]);
        const location = stockLocationOf(vendor, "IN-MH");
        const empty = await liveProduct(api, container, vendor, categoryId, [{ locationId: location, quantity: 0 }], suffix());
        const reservedAll = await liveProduct(api, container, vendor, categoryId, [{ locationId: location, quantity: 2, reserved: 2 }], suffix());

        const response = await ask([empty.productId, reservedAll.productId]);
        expect(response.status).toBe(200);
        expect(response.data.ship_from).toEqual([]);

        // A product stocked only at a location that is not linked to the sales channel.
        const unlinkedVendor = await vendorInStates(api, container, ["IN-MH"]);
        const unlinkedLocation = stockLocationOf(unlinkedVendor, "IN-MH");
        const unlinked = await liveProduct(api, container, unlinkedVendor, categoryId, [{ locationId: unlinkedLocation, quantity: 4 }], suffix());
        expect((await ask([unlinked.productId])).data.ship_from).toHaveLength(1);
        await unlinkLocationFromChannel(container, unlinkedLocation, await getDefaultSalesChannelId(container));
        clearShipFromCache();
        expect((await ask([unlinked.productId])).data.ship_from).toEqual([]);
      });

      it("drops a state when the vendor is suspended or the location is deactivated, and brings it back", async () => {
        const container = getContainer();
        const vendor = await vendorInStates(api, container, ["IN-MH"]);
        const location = stockLocationOf(vendor, "IN-MH");
        const product = await liveProduct(api, container, vendor, categoryId, [{ locationId: location, quantity: 4 }], suffix());
        const vendors = getVendorModule(container) as any;
        const [row] = await vendors.listVendorLocations({ stock_location_id: location }, { take: 1 });

        await vendors.updateVendorLocations({ id: row.id, status: "inactive" });
        clearShipFromCache();
        expect((await ask([product.productId])).data.ship_from).toEqual([]);

        await vendors.updateVendorLocations({ id: row.id, status: "active" });
        clearShipFromCache();
        expect((await ask([product.productId])).data.ship_from).toHaveLength(1);

        await vendors.updateVendors({ id: vendor.vendor_id, status: "suspended" });
        clearShipFromCache();
        expect((await ask([product.productId])).data.ship_from).toEqual([]);

        await vendors.updateVendors({ id: vendor.vendor_id, status: "active" });
        clearShipFromCache();
        expect((await ask([product.productId])).data.ship_from).toHaveLength(1);
      });

      it("never lists a draft, submitted, withdrawn or unpublished product, or one outside the default channel", async () => {
        const container = getContainer();
        const vendor = await vendorInStates(api, container, ["IN-MH"]);
        const location = stockLocationOf(vendor, "IN-MH");

        const draft = await createDraftFor(api, container, vendor, categoryId, suffix());
        const submitted = await createDraftFor(api, container, vendor, categoryId, suffix());
        await api.post(`/vendor/products/${submitted.productId}/submit`, {}, { headers: vendor.headers });
        const withdrawn = await createDraftFor(api, container, vendor, categoryId, suffix());
        await api.post(`/vendor/products/${withdrawn.productId}/submit`, {}, { headers: vendor.headers });
        await api.post(`/vendor/products/${withdrawn.productId}/withdraw`, {}, { headers: vendor.headers });
        const live = await liveProduct(api, container, vendor, categoryId, [{ locationId: location, quantity: 4 }], suffix());
        const unpublished = await liveProduct(api, container, vendor, categoryId, [{ locationId: location, quantity: 4 }], suffix());
        await updateProductsWorkflow(container).run({
          input: { selector: { id: unpublished.productId }, update: { status: "draft" } as never },
        });
        for (const created of [draft, submitted, withdrawn]) {
          await stockProduct(container, created.productId, [{ locationId: location, quantity: 4 }]).catch(() => undefined);
        }

        const response = await ask([draft.productId, submitted.productId, withdrawn.productId, live.productId, unpublished.productId]);
        expect(response.status).toBe(200);
        expect(response.data.ship_from.map((item: any) => item.product_id)).toEqual([live.productId]);
      });

      it("collapses four states into the multiple states phrase", async () => {
        const container = getContainer();
        const vendor = await vendorInStates(api, container, ["IN-MH", "IN-KA", "IN-TN", "IN-DL"]);
        const specs = ["IN-MH", "IN-KA", "IN-TN", "IN-DL"].map((state) => ({ locationId: stockLocationOf(vendor, state), quantity: 3 }));
        const product = await liveProduct(api, container, vendor, categoryId, specs, suffix());

        const response = await ask([product.productId]);
        expect(response.data.ship_from[0].states).toHaveLength(4);
        expect(formatShipFromLabel(response.data.ship_from[0].states)).toBe("Ships from multiple states");
      });

      it("refuses bad input and accepts 24 ids", async () => {
        const ids = (count: number) => Array.from({ length: count }, (_, index) => `prod_SPEC${index}`);
        expect((await ask(ids(25))).status).toBe(400);
        expect((await storeGet(api, key, "/store/ship-from")).status).toBe(400);
        expect((await storeGet(api, key, "/store/ship-from?product_ids=")).status).toBe(400);
        expect((await ask(["prod_ABC", "prod_ABC"])).status).toBe(400);
        expect((await ask(["item_ABC"])).status).toBe(400);
        expect((await storeGet(api, key, "/store/ship-from?product_ids=prod_ABC&fields=id")).status).toBe(400);
        expect((await ask(ids(24))).status).toBe(200);
      });

      it("leaks nothing beyond state codes and names", async () => {
        const container = getContainer();
        const vendor = await vendorInStates(api, container, ["IN-MH", "IN-KA"]);
        const specs = [
          { locationId: stockLocationOf(vendor, "IN-MH"), quantity: 7 },
          { locationId: stockLocationOf(vendor, "IN-KA"), quantity: 9 },
        ];
        const product = await liveProduct(api, container, vendor, categoryId, specs, suffix());
        const bodies = [JSON.stringify((await ask([product.productId])).data), JSON.stringify((await ask(["prod_NONE"])).data)];
        const forbidden = [
          vendor.vendor_id,
          String((vendor as any).email ?? "no-email"),
          "LOC-",
          specs[0].locationId,
          specs[1].locationId,
          "stock",
          "vendor",
          "location",
          ":7",
          ":9",
        ];
        for (const body of bodies) {
          for (const term of forbidden) {
            expect(body.toLowerCase()).not.toContain(term.toLowerCase());
          }
        }
      });

      it("answers a repeat request from the cache and bounds the cache", async () => {
        const container = getContainer();
        const vendor = await vendorInStates(api, container, ["IN-MH"]);
        const location = stockLocationOf(vendor, "IN-MH");
        const product = await liveProduct(api, container, vendor, categoryId, [{ locationId: location, quantity: 4 }], suffix());
        const query = queryOf(container);
        const spy = jest.spyOn(query, "graph");
        const inventoryCalls = () => spy.mock.calls.filter(([config]) => (config as any).entity === "inventory_level").length;

        await ask([product.productId]);
        const first = inventoryCalls();
        expect(first).toBeGreaterThan(0);
        await ask([product.productId]);
        expect(inventoryCalls()).toBe(first);

        clearShipFromCache();
        await ask([product.productId]);
        expect(inventoryCalls()).toBeGreaterThan(first);
        spy.mockRestore();

        clearShipFromCache();
        const many = Array.from({ length: 5_100 }, (_, index) => `prod_BOUND${index}`);
        await getShipFromStates(container, many);
        expect(shipFromCacheSize()).toBeLessThanOrEqual(5_000);
      });

      it("finds the state of a vendor stock location and nothing for the hub or an unknown id", async () => {
        const container = getContainer();
        const vendor = await vendorInStates(api, container, ["IN-KA"]);
        const state = await shipFromStateForStockLocation(container, stockLocationOf(vendor, "IN-KA"));
        expect(state?.name).toBe("Karnataka");
        expect(await shipFromStateForStockLocation(container, "sloc_unknown")).toBeNull();

        const stockModule = container.resolve(Modules.STOCK_LOCATION) as any;
        const [hub] = await stockModule.createStockLocations([{ name: "Spec Hub Location" }]);
        expect(await shipFromStateForStockLocation(container, hub.id)).toBeNull();
      });
    });
  },
});
