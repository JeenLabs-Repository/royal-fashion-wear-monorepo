import { randomUUID } from "node:crypto";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { suspendVendorWorkflow } from "../../src/workflows/vendors/suspend-vendor";
import { toTwoDecimals } from "../../src/lib/catalog/load-content";
import { createPublishableKey } from "../helpers/publishable-key";
import { probe, waitForAuditEntry } from "../helpers/staff-users";
import { createVendorFixture } from "../helpers/vendor-fixtures";
import {
  catalogService,
  createActiveVendor,
  createCategory,
  createDraftViaApi,
  createUploadRow,
  queryOf,
  storeGet,
  validContent,
  vendorSession,
  type ActiveVendor,
} from "../support/catalog-fixtures";

jest.setTimeout(10 * 60 * 1000);

// Mutable settings the mocked reader returns, so a test can make the current agreement
// version differ from the one a vendor accepted.
const mockSettings = { invite_expiry_hours: 72, current_agreement_version: "v1-draft" };

jest.mock("../../src/lib/settings/vendor-onboarding", () => {
  const actual = jest.requireActual("../../src/lib/settings/vendor-onboarding");
  return {
    ...actual,
    getVendorOnboardingSettings: jest.fn(async () => ({ ...mockSettings })),
  };
});

const keysDeep = (value: unknown, keys = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) {
    value.forEach((item) => keysDeep(item, keys));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      keysDeep(item, keys);
    }
  }
  return keys;
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("vendor draft creation and reads", () => {
      let vendorA: ActiveVendor;
      let vendorB: ActiveVendor;
      let categoryId: string;
      let publishableKey: string;

      const countProducts = async (title?: string) => {
        const { data } = await queryOf(getContainer()).graph({
          entity: "product",
          fields: ["id"],
          ...(title ? { filters: { title } } : {}),
        });
        return data.length;
      };

      const draftBody = async (vendor: ActiveVendor, suffix?: string, imageCount = 1) => {
        const uploads = [];
        for (let index = 0; index < imageCount; index += 1) {
          uploads.push(await createUploadRow(getContainer(), vendor.vendor_id));
        }
        return {
          uploads,
          body: validContent({ uploadIds: uploads.map((u) => u.id), categoryId, suffix }),
        };
      };

      beforeAll(async () => {
        const container = getContainer();
        vendorA = await createActiveVendor(api, container, { label: "catalog-a" });
        vendorB = await createActiveVendor(api, container, { label: "catalog-b" });
        categoryId = await createCategory(container, { name: "Apparel Demo" });
        publishableKey = await createPublishableKey(container);
      });

      it("creates a draft that no customer can see and no price is attached to", async () => {
        const container = getContainer();
        const { body } = await draftBody(vendorA, "t1");
        const result = await createDraftViaApi(api, vendorA.headers, body);
        expect(result.status).toBe(201);
        const productId = (result.body as { product: { id: string } }).product.id;

        const { data } = await queryOf(container).graph({
          entity: "product",
          fields: [
            "id",
            "status",
            "metadata",
            "tags.id",
            "sales_channels.id",
            "variants.id",
            "variants.sku",
            "variants.price_set.prices.id",
            "variants.inventory_items.inventory_item_id",
          ],
          filters: { id: productId },
        });
        const product = data[0];
        expect(product.status).toBe("draft");
        expect(product.sales_channels ?? []).toHaveLength(0);
        expect(Object.keys(product.metadata ?? {})).toHaveLength(0);
        expect(product.tags ?? []).toHaveLength(0);
        for (const variant of product.variants) {
          expect(variant.sku ?? null).toBeNull();
          expect(variant.price_set?.prices ?? []).toHaveLength(0);
        }

        // Recorded behaviour: an inventory item exists per variant and holds no level.
        const itemIds = product.variants.flatMap((v: any) =>
          (v.inventory_items ?? []).map((l: any) => l.inventory_item_id)
        );
        expect(itemIds).toHaveLength(2);
        const levels = await queryOf(container).graph({
          entity: "inventory_level",
          fields: ["id"],
          filters: { inventory_item_id: itemIds },
        });
        expect(levels.data).toHaveLength(0);

        const list = await storeGet(api, publishableKey, "/store/products?fields=id&limit=100");
        expect((list.data.products as any[]).some((p) => p.id === productId)).toBe(false);
        const byId = await storeGet(api, publishableKey, `/store/products/${productId}`);
        expect(byId.status).toBe(404);

        const refs = await catalogService(container).listVendorVariantRefs(
          { product_id: productId },
          { take: null }
        );
        const first = refs.find((ref: any) => ref.vendor_sku === "t1-S") as any;
        expect(toTwoDecimals(first.raw_payout_price ?? first.payout_price)).toBe("199.99");
        expect(Number(first.payout_price)).toBe(199.99);
      });

      it("rejects every key the vendor may not send and every out-of-range value", async () => {
        const container = getContainer();
        const upload = await createUploadRow(container, vendorA.vendor_id);
        const base = () => validContent({ uploadIds: [upload.id], categoryId, suffix: "t2" });
        const before = await countProducts();

        const forbidden: [string, unknown][] = [
          ["status", "published"],
          ["metadata", { a: 1 }],
          ["handle", "my-handle"],
          ["sales_channels", ["sc_x"]],
          ["tags", ["t"]],
          ["price", "10.00"],
          ["vendor_id", "vnd_x"],
          ["sku", "X"],
        ];
        for (const [key, value] of forbidden) {
          const result = await createDraftViaApi(api, vendorA.headers, { ...base(), [key]: value });
          const body = result.body as { code: string; issues: { path: string }[] };
          expect(result.status).toBe(400);
          expect(body.code).toBe("validation_failed");
          expect(body.issues.some((issue) => issue.path === key || issue.path.startsWith(`${key}.`))).toBe(true);
        }

        const variant = (sku: string, price = "10.00") => ({
          vendor_sku: sku,
          option_values: { Size: "S" },
          payout_price: price,
        });
        const cases: [string, Record<string, unknown>, string][] = [
          ["images", { images: [] }, "images"],
          [
            "images",
            { images: Array.from({ length: 11 }, (_, i) => ({ upload_id: `vupl_fake_${i}` })) },
            "images",
          ],
          [
            "options",
            {
              options: ["A", "B", "C", "D"].map((title) => ({ title, values: ["x"] })),
              variants: [{ vendor_sku: "o-1", option_values: { A: "x", B: "x", C: "x", D: "x" }, payout_price: "10.00" }],
            },
            "options",
          ],
          [
            "variants",
            {
              options: [{ title: "Size", values: Array.from({ length: 51 }, (_, i) => `v${i}`) }],
              variants: Array.from({ length: 51 }, (_, i) => ({
                vendor_sku: `many-${i}`,
                option_values: { Size: `v${i}` },
                payout_price: "10.00",
              })),
            },
            "variants",
          ],
          [
            "duplicate sku in body",
            { variants: [variant("dup-1"), { ...variant("dup-1"), option_values: { Size: "M" } }] },
            "variants.1.vendor_sku",
          ],
          ["title", { title: "x".repeat(151) }, "title"],
          ["price 0", { variants: [variant("p-0", "0"), { ...variant("p-1"), option_values: { Size: "M" } }] }, "variants.0.payout_price"],
          ["price 1e3", { variants: [variant("p-2", "1e3"), { ...variant("p-3"), option_values: { Size: "M" } }] }, "variants.0.payout_price"],
          ["price 12.345", { variants: [variant("p-4", "12.345"), { ...variant("p-5"), option_values: { Size: "M" } }] }, "variants.0.payout_price"],
        ];
        for (const [name, patch, path] of cases) {
          const result = await createDraftViaApi(api, vendorA.headers, { ...base(), ...patch });
          const body = result.body as { code: string; issues: { path: string }[] };
          expect({ name, status: result.status }).toEqual({ name, status: 400 });
          expect(body.code).toBe("validation_failed");
          expect(body.issues.some((issue) => issue.path === path || issue.path.startsWith(`${path}.`))).toBe(true);
        }
        expect(await countProducts()).toBe(before);
      });

      it("keeps uploads and SKUs inside the vendor that owns them", async () => {
        const container = getContainer();
        const first = await draftBody(vendorA, "t3");
        const created = await createDraftViaApi(api, vendorA.headers, first.body);
        expect(created.status).toBe(201);

        // Another vendor's upload and an unknown upload give the same answer.
        const foreignUpload = await createUploadRow(container, vendorB.vendor_id);
        const foreign = await createDraftViaApi(
          api,
          vendorA.headers,
          validContent({ uploadIds: [foreignUpload.id], categoryId, suffix: "t3-foreign" })
        );
        const unknown = await createDraftViaApi(
          api,
          vendorA.headers,
          validContent({ uploadIds: ["vupl_does_not_exist"], categoryId, suffix: "t3-unknown" })
        );
        expect(foreign.status).toBe(404);
        expect(unknown.status).toBe(404);
        expect(foreign.body).toEqual(unknown.body);
        expect((foreign.body as { code: string }).code).toBe("unknown_upload");

        // An upload used by an earlier draft.
        const reuse = await createDraftViaApi(
          api,
          vendorA.headers,
          validContent({ uploadIds: first.uploads.map((u) => u.id), categoryId, suffix: "t3-reuse" })
        );
        expect(reuse.status).toBe(409);
        expect((reuse.body as { code: string }).code).toBe("upload_already_used");

        // The same vendor SKU twice for one vendor, and once for another.
        const second = await draftBody(vendorA, "t3");
        const duplicate = await createDraftViaApi(api, vendorA.headers, second.body);
        expect(duplicate.status).toBe(409);
        expect((duplicate.body as { code: string }).code).toBe("duplicate_vendor_sku");

        const forB = await draftBody(vendorB, "t3");
        const other = await createDraftViaApi(api, vendorB.headers, forB.body);
        expect(other.status).toBe(201);
      });

      it("accepts only an active public category", async () => {
        const inactive = await createCategory(getContainer(), { name: "Inactive Demo", is_active: false });
        const internal = await createCategory(getContainer(), { name: "Internal Demo", is_internal: true });
        for (const bad of [inactive, internal, "pcat_does_not_exist"]) {
          const upload = await createUploadRow(getContainer(), vendorA.vendor_id);
          const result = await createDraftViaApi(
            api,
            vendorA.headers,
            validContent({ uploadIds: [upload.id], categoryId: bad, suffix: `t4-${bad.slice(-4)}` })
          );
          expect(result.status).toBe(400);
          expect((result.body as { code: string }).code).toBe("unknown_category");
        }
        const { body } = await draftBody(vendorA, "t4-ok");
        const ok = await createDraftViaApi(api, vendorA.headers, body);
        expect(ok.status).toBe(201);
      });

      it("refuses vendors that are not eligible and creates nothing", async () => {
        const container = getContainer();
        const before = await countProducts();

        // Invited, registered, not yet active: refused by the status guard.
        const invited = await createVendorFixture(container, { label: "catalog-invited", status: "invited" });
        const invitedHeaders = await vendorSession(api, invited);
        const upload = await createUploadRow(container, invited.vendor_id);
        const refusedInvited = await createDraftViaApi(
          api,
          invitedHeaders,
          validContent({ uploadIds: [upload.id], categoryId, suffix: "t5-invited" })
        );
        expect(refusedInvited.status).toBe(403);

        // Active vendor whose accepted agreement version is no longer the current one.
        const stale = await createActiveVendor(api, container, { label: "catalog-stale" });
        const staleUpload = await createUploadRow(container, stale.vendor_id);
        mockSettings.current_agreement_version = "v2-test";
        try {
          const refusedStale = await createDraftViaApi(
            api,
            stale.headers,
            validContent({ uploadIds: [staleUpload.id], categoryId, suffix: "t5-stale" })
          );
          expect(refusedStale.status).toBe(403);
          expect((refusedStale.body as { code: string }).code).toBe("vendor_not_eligible");
        } finally {
          mockSettings.current_agreement_version = "v1-draft";
        }

        // Suspended after the session was issued.
        const suspended = await createActiveVendor(api, container, { label: "catalog-suspended" });
        const suspendedUpload = await createUploadRow(container, suspended.vendor_id);
        await suspendVendorWorkflow(container).run({
          input: { vendor_id: suspended.vendor_id, reason: "Suspended by a test", actor: { id: "catalog-test" } },
        });
        const refusedSuspended = await createDraftViaApi(
          api,
          suspended.headers,
          validContent({ uploadIds: [suspendedUpload.id], categoryId, suffix: "t5-suspended" })
        );
        expect(refusedSuspended.status).toBe(403);

        expect(await countProducts()).toBe(before);
      });

      it("stores the declaration and the per-variant legal metrology values", async () => {
        const container = getContainer();
        const { body } = await draftBody(vendorA, "t6");
        const result = await createDraftViaApi(api, vendorA.headers, body);
        expect(result.status).toBe(201);
        const productId = (result.body as { product: { id: string } }).product.id;
        const service = catalogService(container);

        const [declaration] = (await service.listProductDeclarations({ product_id: productId })) as any[];
        expect(declaration).toMatchObject({
          generic_name: "Cotton T-Shirt",
          country_of_origin: "IN",
          packed_by_name: "Demo Packing Works",
          packed_by_address: "1 Demo Street, Mumbai 400001",
        });
        const refs = (await service.listVendorVariantRefs({ product_id: productId }, { take: null })) as any[];
        const small = refs.find((ref) => ref.vendor_sku === "t6-S");
        expect(toTwoDecimals(small.raw_mrp ?? small.mrp)).toBe("299.00");
        expect(small.net_quantity_value).toBe(1);
        expect(small.net_quantity_unit).toBe("pcs");

        // The four declaration fields are required, so a partial declaration is refused.
        const partial = await draftBody(vendorA, "t6-partial");
        const refused = await createDraftViaApi(api, vendorA.headers, {
          ...partial.body,
          declaration: { generic_name: "Cotton T-Shirt" },
        });
        expect(refused.status).toBe(400);
        expect(JSON.stringify(refused.body)).toContain("declaration.country_of_origin");
      });

      it("scopes lists and details to the calling vendor", async () => {
        const container = getContainer();
        const vendorC = await createActiveVendor(api, container, { label: "catalog-paging" });
        const ids: string[] = [];
        for (let index = 0; index < 21; index += 1) {
          const upload = await createUploadRow(container, vendorC.vendor_id);
          const created = await createDraftViaApi(
            api,
            vendorC.headers,
            validContent({
              uploadIds: [upload.id],
              categoryId,
              suffix: `page-${String(index).padStart(2, "0")}`,
              overrides: { title: `Paging Item ${String(index).padStart(2, "0")}` },
            })
          );
          expect(created.status).toBe(201);
          ids.push((created.body as { product: { id: string } }).product.id);
        }

        const firstPage = await probe(api, vendorC.headers, "GET", "/vendor/products");
        const page = firstPage.body as { products: any[]; count: number; limit: number; offset: number };
        expect(firstPage.status).toBe(200);
        expect(page.products).toHaveLength(20);
        expect(page.count).toBe(21);
        expect(page.limit).toBe(20);
        expect(Object.keys(page.products[0]).sort()).toEqual(
          ["has_pending", "id", "is_live", "state", "thumbnail", "title", "updated_at", "variant_count"].sort()
        );
        const secondPage = await probe(
          api,
          vendorC.headers,
          "GET",
          "/vendor/products?limit=20&offset=20"
        );
        expect(secondPage.status).toBe(200);
        expect((secondPage.body as { products: any[] }).products).toHaveLength(1);
        const filtered = await probe(
          api,
          vendorC.headers,
          "GET",
          "/vendor/products?q=item%2007&state=draft&limit=20"
        );
        expect(filtered.status).toBe(200);
        expect((filtered.body as { products: any[] }).products).toHaveLength(1);
        for (const bad of ["limit=21", "limit=0", "state=bogus", `vendor_id=${vendorC.vendor_id}`, "zz=1"]) {
          const refused = await probe(api, vendorC.headers, "GET", `/vendor/products?${bad}`);
          expect(refused.status).toBe(400);
        }

        // Vendor A does not see vendor C's products, and vendor B gets 404 for their ids.
        const listA = await probe(api, vendorA.headers, "GET", "/vendor/products?limit=20");
        const idsA = (listA.body as { products: { id: string }[] }).products.map((p) => p.id);
        expect(idsA.some((id) => ids.includes(id))).toBe(false);
        const foreign = await probe(api, vendorB.headers, "GET", `/vendor/products/${ids[0]}`);
        const missing = await probe(api, vendorB.headers, "GET", "/vendor/products/prod_does_not_exist");
        expect(foreign.status).toBe(404);
        expect(missing.status).toBe(404);
        expect((foreign.body as { message: string }).message).toBe((missing.body as { message: string }).message);

        // The caller's own detail carries SKU and payout price and no internals.
        const own = await probe(api, vendorC.headers, "GET", `/vendor/products/${ids[0]}`);
        expect(own.status).toBe(200);
        const detail = (own.body as { product: any }).product;
        expect(detail.content.variants[0].vendor_sku).toBeDefined();
        expect(detail.content.variants[0].payout_price).toBeDefined();
        const keys = keysDeep(own.body);
        for (const banned of ["handle", "sales_channels", "metadata", "tags", "price", "vendor_id"]) {
          expect(keys.has(banned)).toBe(false);
        }

        const categories = await probe(api, vendorA.headers, "GET", "/vendor/categories");
        expect(categories.status).toBe(200);
        for (const category of (categories.body as { categories: any[] }).categories) {
          expect(Object.keys(category).sort()).toEqual(["id", "name"]);
        }
      });

      it("rolls everything back when the submission step fails", async () => {
        const container = getContainer();
        const title = `Rollback Item ${randomUUID()}`;
        const upload = await createUploadRow(container, vendorA.vendor_id);
        const service = catalogService(container);
        const spy = jest
          .spyOn(service, "createProductSubmissions")
          .mockRejectedValueOnce(new Error("forced failure in the submission step"));
        try {
          const result = await createDraftViaApi(
            api,
            vendorA.headers,
            validContent({ uploadIds: [upload.id], categoryId, suffix: "t8", overrides: { title } })
          );
          expect(result.status).toBeGreaterThanOrEqual(500);
        } finally {
          spy.mockRestore();
        }
        expect(await countProducts(title)).toBe(0);
        const refs = await service.listVendorVariantRefs({ vendor_sku: ["t8-S", "t8-M"] }, { take: null });
        expect(refs).toHaveLength(0);
        const [row] = (await service.listVendorUploads({ id: [upload.id] })) as any[];
        expect(row.product_id ?? null).toBeNull();
      });

      it("records key names only in the audit entry of a creation", async () => {
        const container = getContainer();
        const canaryTitle = "Canary Title zq81f3";
        const canarySku = "canary-sku-zq81f3";
        const upload = await createUploadRow(container, vendorA.vendor_id);
        const body = validContent({
          uploadIds: [upload.id],
          categoryId,
          suffix: canarySku,
          overrides: { title: canaryTitle, description: "Canary description zq81f3" },
        });
        const result = await createDraftViaApi(api, vendorA.headers, body);
        expect(result.status).toBe(201);

        const entry = await waitForAuditEntry(
          container,
          (row) =>
            row.action === "vendor.request" &&
            row.actor_id === vendorA.user_id &&
            row.http_method === "POST" &&
            Array.isArray((row.meta as { body_keys?: string[] } | null)?.body_keys) &&
            (row.meta as { body_keys: string[] }).body_keys.includes("variants")
        );
        expect(entry).not.toBeNull();
        const text = JSON.stringify(entry);
        for (const value of [canaryTitle, canarySku, "Canary description", "199.99", "209.50", "Demo Packing Works"]) {
          expect(text).not.toContain(value);
        }
        expect((entry!.meta as { body_keys: string[] }).body_keys).toEqual(Object.keys(body).sort());
      });
    });
  },
});
