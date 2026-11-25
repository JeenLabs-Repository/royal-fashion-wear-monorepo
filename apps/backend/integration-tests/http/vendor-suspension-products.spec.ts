import { createServer, type Server } from "node:http";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createPublishableKey } from "../helpers/publishable-key";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { clearShipFromCache } from "../../src/lib/ship-from";
import {
  hideVendorProducts,
  restoreVendorProducts,
} from "../../src/lib/catalog/vendor-product-visibility";
import { reactivateVendorWorkflow } from "../../src/workflows/vendors/reactivate-vendor";
import { suspendVendorWorkflow } from "../../src/workflows/vendors/suspend-vendor";
import { catalogService, createCategory, createDraftFor, storeGet } from "../support/catalog-fixtures";
import { liveProduct, stockLocationOf, vendorInStates } from "../support/ship-from-fixtures";
import { registerStubPlugin, stubPlugin } from "../stubs/vendor-compliance-stub";

jest.setTimeout(240 * 1000);

// The compliance stub shares the onVendorActivating registry with the catalog
// handlers. Medusa itself refuses a second direct hooks.vendorActivating attach.
registerStubPlugin();

const actor = { id: "user_suspension_spec", label: "suspension-spec@example.test" };
const REASON = "Suspended while the spec runs";

// A server that stands in for the storefront and records revalidation requests.
const revalidations: string[] = [];
let storefront: Server;

beforeAll(async () => {
  storefront = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      revalidations.push(body);
      response.statusCode = 200;
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => storefront.listen(0, "127.0.0.1", resolve));
  const address = storefront.address() as { port: number };
  process.env.STOREFRONT_URL = `http://127.0.0.1:${address.port}`;
  process.env.REVALIDATE_SECRET = "spec-revalidate-secret";
});

afterAll(async () => {
  await new Promise<void>((resolve) => storefront.close(() => resolve()));
});

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("vendor suspension and the storefront", () => {
      let key = "";
      let categoryId = "";
      let counter = 0;
      const suffix = () => `sp${Date.now().toString(36)}${(counter += 1)}`;

      beforeEach(async () => {
        const container = getContainer();
        key = await createPublishableKey(container);
        categoryId = await createCategory(container);
        stubPlugin.enabled = false;
        stubPlugin.activations.length = 0;
        revalidations.length = 0;
        clearShipFromCache();
      });

      const listedIds = async (): Promise<string[]> => {
        const response = await storeGet(api, key, "/store/products?limit=100&fields=id");
        return (response.data.products ?? []).map((product: any) => product.id);
      };

      // Decision 0021: after an unlink the Store list can still include the id in this
      // suite; by-id 404 / 200 is the reliable customer-facing signal.
      const storeStatus = async (productId: string): Promise<number> =>
        (await storeGet(api, key, `/store/products/${productId}`)).status;

      const suspend = (container: any, vendorId: string) =>
        suspendVendorWorkflow(container).run({
          input: { vendor_id: vendorId, reason: REASON, actor },
        });
      const reactivate = (container: any, vendorId: string) =>
        reactivateVendorWorkflow(container).run({
          input: { vendor_id: vendorId, reason: "Reactivated for the spec", actor },
        });

      const setup = async () => {
        const container = getContainer();
        const vendor = await vendorInStates(api, container, ["IN-MH"]);
        const location = stockLocationOf(vendor, "IN-MH");
        const product = await liveProduct(
          api,
          container,
          vendor,
          categoryId,
          [{ locationId: location, quantity: 5 }],
          suffix()
        );
        return { container, vendor, product };
      };

      it("hides every live product on suspension and leaves other vendors alone", async () => {
        const { container, vendor, product } = await setup();
        const other = await vendorInStates(api, container, ["IN-MH"]);
        const otherProduct = await liveProduct(
          api,
          container,
          other,
          categoryId,
          [{ locationId: stockLocationOf(other, "IN-MH"), quantity: 5 }],
          suffix()
        );
        expect(await listedIds()).toEqual(
          expect.arrayContaining([product.productId, otherProduct.productId])
        );

        await suspend(container, vendor.vendor_id);
        clearShipFromCache();

        expect(await storeStatus(product.productId)).toBe(404);
        expect(await storeStatus(otherProduct.productId)).toBe(200);
        const shipFrom = await storeGet(
          api,
          key,
          `/store/ship-from?product_ids=${product.productId}`
        );
        expect(shipFrom.data.ship_from).toEqual([]);
        const [row] = await catalogService(container).listProductSubmissions(
          { product_id: product.productId },
          { take: 1 }
        );
        expect(row.hidden_by_suspension).toBe(true);
        const [otherRow] = await catalogService(container).listProductSubmissions(
          { product_id: otherProduct.productId },
          { take: 1 }
        );
        expect(otherRow.hidden_by_suspension).toBe(false);
      });

      it("restores exactly the flagged products on reactivation without a new review", async () => {
        const { container, vendor, product } = await setup();
        const before = await storeGet(
          api,
          key,
          `/store/products/${product.productId}?fields=id,handle,*variants,+variants.sku`
        );
        const [beforeRow] = await catalogService(container).listProductSubmissions(
          { product_id: product.productId },
          { take: 1 }
        );

        await suspend(container, vendor.vendor_id);
        await reactivate(container, vendor.vendor_id);

        const after = await storeGet(
          api,
          key,
          `/store/products/${product.productId}?fields=id,handle,*variants,+variants.sku`
        );
        expect(after.status).toBe(200);
        expect(after.data.product.handle).toBe(before.data.product.handle);
        expect(after.data.product.variants.map((variant: any) => variant.sku).sort()).toEqual(
          before.data.product.variants.map((variant: any) => variant.sku).sort()
        );
        const [afterRow] = await catalogService(container).listProductSubmissions(
          { product_id: product.productId },
          { take: 1 }
        );
        expect(afterRow.hidden_by_suspension).toBe(false);
        expect(afterRow.state).toBe("approved");
        expect(afterRow.approved_content_hash).toBe(beforeRow.approved_content_hash);
      });

      it("hides and restores a product with a pending live edit and keeps its pending change", async () => {
        const { container, vendor, product } = await setup();
        const service = catalogService(container);
        const [row] = await service.listProductSubmissions(
          { product_id: product.productId },
          { take: 1 }
        );
        await service.updateProductSubmissions({
          id: row.id,
          state: "submitted",
          pending_changes: { title: "Pending title that must survive" },
        });

        await suspend(container, vendor.vendor_id);
        expect(await storeStatus(product.productId)).toBe(404);
        await reactivate(container, vendor.vendor_id);
        expect(await storeStatus(product.productId)).toBe(200);

        const [after] = await service.listProductSubmissions(
          { product_id: product.productId },
          { take: 1 }
        );
        expect(after.pending_changes).toEqual({ title: "Pending title that must survive" });
        expect(after.state).toBe("submitted");
      });

      it("never touches a draft, a submitted product that is not live, or a withdrawn product", async () => {
        const { container, vendor, product } = await setup();
        const draft = await createDraftFor(api, container, vendor, categoryId, suffix());
        const submitted = await createDraftFor(api, container, vendor, categoryId, suffix());
        await api.post(`/vendor/products/${submitted.productId}/submit`, {}, { headers: vendor.headers });
        const withdrawn = await createDraftFor(api, container, vendor, categoryId, suffix());
        await api.post(`/vendor/products/${withdrawn.productId}/submit`, {}, { headers: vendor.headers });
        await api.post(`/vendor/products/${withdrawn.productId}/withdraw`, {}, { headers: vendor.headers });

        await suspend(container, vendor.vendor_id);
        const service = catalogService(container);
        for (const created of [draft, submitted, withdrawn]) {
          const [row] = await service.listProductSubmissions(
            { product_id: created.productId },
            { take: 1 }
          );
          expect(row.hidden_by_suspension).toBe(false);
        }
        await reactivate(container, vendor.vendor_id);
        const ids = await listedIds();
        for (const created of [draft, submitted, withdrawn]) {
          expect(ids).not.toContain(created.productId);
        }
        expect(ids).toContain(product.productId);
      });

      it("is idempotent when run twice or when nothing is flagged", async () => {
        const { container, vendor, product } = await setup();
        const first = await hideVendorProducts(container, vendor.vendor_id);
        const second = await hideVendorProducts(container, vendor.vendor_id);
        expect(first).toEqual([product.productId]);
        expect(second).toEqual([]);

        expect(await restoreVendorProducts(container, vendor.vendor_id)).toEqual([
          product.productId,
        ]);
        expect(await restoreVendorProducts(container, vendor.vendor_id)).toEqual([]);
        expect(await listedIds()).toContain(product.productId);
      });

      it("keeps a vendor suspended and its products hidden when activation is blocked", async () => {
        const { container, vendor, product } = await setup();
        await suspend(container, vendor.vendor_id);
        expect(await storeStatus(product.productId)).toBe(404);

        stubPlugin.enabled = true;
        stubPlugin.activations.length = 0;
        await expect(reactivate(container, vendor.vendor_id)).rejects.toMatchObject({
          message: stubPlugin.blockMessage,
        });
        stubPlugin.enabled = false;

        const [stored] = await getVendorModule(container).listVendors(
          { id: vendor.vendor_id },
          { take: 1 }
        );
        expect(stored.status).toBe("suspended");
        expect(await storeStatus(product.productId)).toBe(404);
        const [row] = await catalogService(container).listProductSubmissions(
          { product_id: product.productId },
          { take: 1 }
        );
        expect(row.hidden_by_suspension).toBe(true);

        // The compensation of the activation handler hides exactly what that handler relinked.
        const relinked = await restoreVendorProducts(container, vendor.vendor_id);
        expect(await storeStatus(product.productId)).toBe(200);
        await hideVendorProducts(container, vendor.vendor_id, { productIds: relinked });
        expect(await storeStatus(product.productId)).toBe(404);
      });

      it("asks the storefront to revalidate each affected product", async () => {
        const { container, vendor, product } = await setup();
        const arrived = async (count: number) => {
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline && revalidations.length < count) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return revalidations.length;
        };

        await suspend(container, vendor.vendor_id);
        expect(await arrived(1)).toBeGreaterThanOrEqual(1);
        expect(revalidations.join(" ")).toContain(product.productId);

        const seen = revalidations.length;
        await reactivate(container, vendor.vendor_id);
        expect(await arrived(seen + 1)).toBeGreaterThan(seen);
      });
    });
  },
});
