import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createRegionsWorkflow } from "@medusajs/medusa/core-flows";
import { createPublishableKey } from "../helpers/publishable-key";

jest.setTimeout(120 * 1000);

// The test client throws on a non-2xx answer; read status and body from either side.
const settle = <T extends { status: number; data: any }>(request: Promise<T>) =>
  request
    .then((response) => ({ status: response.status, data: response.data }))
    .catch((error) => ({
      status: error.response?.status as number | undefined,
      data: error.response?.data as any,
    }));

const STARTER_LIST =
  "*variants.calculated_price,+variants.inventory_quantity,*variants.images,*variants.options,+options.values.metadata,+metadata,+tags,*categories";

const FORBIDDEN_URLS = [
  "/store/products?fields=vendor_id",
  "/store/products?fields=%2Bstock_location",
  "/store/products?fields=*variants.inventory_items",
  "/store/products?expand=location_levels",
  "/store/products?include=reservations",
  "/store/products?fields[]=awb",
  "/store/regions?fields=vendor",
  `/store/products?fields=${"a,".repeat(2100)}`,
];

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("store guard", () => {
      let headers: { headers: Record<string, string> };
      let regionId: string;

      // The runner empties the database between tests, so the key is made each time.
      beforeEach(async () => {
        const container = getContainer();
        const token = await createPublishableKey(container);
        headers = { headers: { "x-publishable-api-key": token } };

        // *variants.calculated_price needs a region_id on this Medusa version;
        // currency_code is not accepted as a Store products query field.
        const {
          result: [region],
        } = await createRegionsWorkflow(container).run({
          input: {
            regions: [
              {
                name: "Store guard test",
                currency_code: "usd",
                countries: ["us"],
                payment_providers: ["pp_system_default"],
              },
            ],
          },
        });
        regionId = region.id;
      });

      it.each(FORBIDDEN_URLS)("answers 400 forbidden_field for %s", async (url) => {
        const { status, data } = await settle(api.get(url, headers));
        expect(status).toBe(400);
        expect(data.code).toBe("forbidden_field");
        expect(data.type).toBe("invalid_data");
      });

      it("lets the storefront's own product list through", async () => {
        const url = `/store/products?fields=${encodeURIComponent(STARTER_LIST)}&region_id=${regionId}`;
        const { status } = await settle(api.get(url, headers));
        expect(status).toBe(200);
      });

      it("allows plain metadata", async () => {
        const { status } = await settle(api.get("/store/products?fields=%2Bmetadata", headers));
        expect(status).toBe(200);
      });

      it("answers a store route with no field parameters", async () => {
        const { status } = await settle(api.get("/store/regions", headers));
        expect(status).toBe(200);
      });

      it("leaves the core validation of other parameters alone", async () => {
        const { status, data } = await settle(api.get("/store/products?limit=abc", headers));
        expect(status).toBe(400);
        expect(data.code).not.toBe("forbidden_field");
      });

      it("does not touch admin routes", async () => {
        const { status, data } = await settle(api.get("/admin/products?fields=vendor_id"));
        expect(status).toBe(401);
        expect(data?.code).not.toBe("forbidden_field");
      });

      it("does not touch vendor routes", async () => {
        const { data } = await settle(api.get("/vendor/anything?fields=vendor_id"));
        expect(data?.code).not.toBe("forbidden_field");
      });
    });
  },
});
