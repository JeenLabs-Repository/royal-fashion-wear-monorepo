import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import { clearShipFromCache } from "../../src/lib/ship-from";
import { createPublishableKey } from "../helpers/publishable-key";
import { createCategory, createDraftFor, storeGet } from "../support/catalog-fixtures";
import { liveProduct, setDeclaration, stockLocationOf, vendorInStates } from "../support/ship-from-fixtures";

jest.setTimeout(180 * 1000);

// Only the Integration Module call at the reader's boundary is replaced. The reader and the
// route run for real, so a value travels through the reader's parsing and the route.
const mockResolver = {
  behaviour: "none" as "none" | "resolved" | "disabled" | "throw",
  options: {} as Record<string, unknown>,
};

jest.mock("../../src/lib/settings/resolve-options", () => {
  const actual = jest.requireActual("../../src/lib/settings/resolve-options");
  return {
    ...actual,
    fetchResolvedOptions: jest.fn(async (container: unknown, identifier: string) => {
      switch (mockResolver.behaviour) {
        case "resolved":
          return { status: "resolved", options: mockResolver.options };
        case "disabled":
          return { status: "unavailable", reason: "disabled" };
        case "throw":
          throw new Error("integration module failed");
        default:
          return actual.fetchResolvedOptions(container, identifier);
      }
    }),
  };
});

const CANARY_GENERIC = "Canary Generic Name 41Q";
const CANARY_PACKER = "Canary Packer Works 41Q";
const CANARY_ADDRESS = "41 Canary Lane, Pune";
const CANARY_MARKETER = "Canary Marketer Text Ltd";

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("GET /store/product-declarations", () => {
      let key = "";
      let categoryId = "";
      let productIds: string[] = [];
      let draftId = "";
      let counter = 0;

      const ask = (ids: string[]) => storeGet(api, key, `/store/product-declarations?product_ids=${ids.join(",")}`);

      beforeEach(async () => {
        mockResolver.behaviour = "none";
        mockResolver.options = {};
        clearShipFromCache();
        const container = getContainer();
        key = await createPublishableKey(container);
        categoryId = await createCategory(container);
        const vendor = await vendorInStates(api, container, ["IN-MH"]);
        const location = stockLocationOf(vendor, "IN-MH");
        productIds = [];
        for (let index = 0; index < 2; index += 1) {
          counter += 1;
          const made = await liveProduct(api, container, vendor, categoryId, [{ locationId: location, quantity: 3 }], `dec${Date.now().toString(36)}${counter}`);
          await setDeclaration(container, made.productId, {
            generic_name: `${CANARY_GENERIC} ${index}`,
            country_of_origin: "IN",
            packed_by_name: `${CANARY_PACKER} ${index}`,
            packed_by_address: CANARY_ADDRESS,
          });
          productIds.push(made.productId);
        }
        counter += 1;
        draftId = (await createDraftFor(api, container, vendor, categoryId, `dec${Date.now().toString(36)}${counter}`)).productId;
      });

      it("shows nothing by default when no card exists", async () => {
        const response = await ask(productIds);
        expect(response.status).toBe(200);
        expect(response.data).toEqual({ mode: "hidden", declarations: [] });
        const text = JSON.stringify(response.data);
        for (const canary of [CANARY_GENERIC, CANARY_PACKER, CANARY_ADDRESS]) {
          expect(text).not.toContain(canary);
        }
      });

      it("shows the owner text on every listed product in owner_marketer mode and no declaration value", async () => {
        mockResolver.behaviour = "resolved";
        mockResolver.options = { lm_display_mode: "owner_marketer", lm_marketer_text: CANARY_MARKETER };
        const response = await ask(productIds);
        expect(response.status).toBe(200);
        expect(response.data.mode).toBe("owner_marketer");
        expect(response.data.declarations).toHaveLength(2);
        for (const entry of response.data.declarations) {
          expect(entry.lines).toEqual([{ label: "Marketed by", value: CANARY_MARKETER }]);
        }
        const text = JSON.stringify(response.data);
        for (const canary of [CANARY_GENERIC, CANARY_PACKER, CANARY_ADDRESS]) {
          expect(text).not.toContain(canary);
        }
      });

      it("shows each declaration as entered in product_declared mode and nothing else", async () => {
        mockResolver.behaviour = "resolved";
        mockResolver.options = { lm_display_mode: "product_declared", lm_marketer_text: CANARY_MARKETER };
        const response = await ask(productIds);
        expect(response.status).toBe(200);
        expect(response.data.mode).toBe("product_declared");
        expect(response.data.declarations).toHaveLength(2);
        for (const entry of response.data.declarations) {
          expect(Object.keys(entry).sort()).toEqual(["lines", "product_id"]);
          expect(entry.lines.map((line: any) => line.label)).toEqual(["Generic name", "Country of origin", "Packed by", "Address"]);
          expect(entry.lines.find((line: any) => line.label === "Country of origin").value).toBe("India");
        }
        const text = JSON.stringify(response.data);
        expect(text).toContain(CANARY_GENERIC);
        expect(text).not.toContain(CANARY_MARKETER);
        for (const hidden of ["PL-", "mrp", "net_quantity", "payout", "vendor", "sku"]) {
          expect(text.toLowerCase()).not.toContain(hidden.toLowerCase());
        }
      });

      it("omits unpublished, draft and unknown products and applies the same id rules as ship-from", async () => {
        mockResolver.behaviour = "resolved";
        mockResolver.options = { lm_display_mode: "owner_marketer", lm_marketer_text: CANARY_MARKETER };
        const container = getContainer();
        await updateProductsWorkflow(container).run({
          input: { selector: { id: productIds[1] }, update: { status: "draft" } as never },
        });
        const response = await ask([productIds[0], productIds[1], draftId, "prod_UNKNOWN"]);
        expect(response.status).toBe(200);
        expect(response.data.declarations.map((entry: any) => entry.product_id)).toEqual([productIds[0]]);

        const ids = (count: number) => Array.from({ length: count }, (_, index) => `prod_SPEC${index}`);
        expect((await ask(ids(25))).status).toBe(400);
        expect((await ask(ids(24))).status).toBe(200);
        expect((await ask(["prod_A", "prod_A"])).status).toBe(400);
        expect((await ask(["x_1"])).status).toBe(400);
        expect((await storeGet(api, key, `/store/product-declarations?product_ids=prod_A&fields=id`)).status).toBe(400);
      });

      it("follows the resolved value on the next request with no restart", async () => {
        mockResolver.behaviour = "resolved";
        mockResolver.options = { lm_display_mode: "product_declared", lm_marketer_text: CANARY_MARKETER };
        expect((await ask([productIds[0]])).data.mode).toBe("product_declared");

        mockResolver.options = { lm_display_mode: "owner_marketer", lm_marketer_text: CANARY_MARKETER };
        const second = await ask([productIds[0]]);
        expect(second.data.mode).toBe("owner_marketer");
        expect(second.data.declarations[0].lines[0].label).toBe("Marketed by");

        mockResolver.behaviour = "disabled";
        expect((await ask([productIds[0]])).data).toEqual({ mode: "hidden", declarations: [] });

        mockResolver.behaviour = "resolved";
        mockResolver.options = { lm_display_mode: "shown", lm_marketer_text: CANARY_MARKETER };
        expect((await ask([productIds[0]])).data).toEqual({ mode: "hidden", declarations: [] });
      });

      it("fails closed when the settings call throws", async () => {
        mockResolver.behaviour = "throw";
        const response = await ask(productIds);
        expect(response.status).toBe(200);
        expect(response.data).toEqual({ mode: "hidden", declarations: [] });
        expect(JSON.stringify(response.data)).not.toContain(CANARY_PACKER);
      });
    });
  },
});
