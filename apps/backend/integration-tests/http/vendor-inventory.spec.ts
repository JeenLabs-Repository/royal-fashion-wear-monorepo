import { randomUUID } from "node:crypto";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { suspendVendorWorkflow } from "../../src/workflows/vendors/suspend-vendor";
import { createPublishableKey } from "../helpers/publishable-key";
import { probe, waitForAuditEntry } from "../helpers/staff-users";
import { createVendorFixture, ensureDefaultSalesChannel } from "../helpers/vendor-fixtures";
import {
  createActiveVendor,
  createCategory,
  createDraftFor,
  storeGet,
  vendorSession,
  type ActiveVendor,
} from "../support/catalog-fixtures";
import { approveViaApi, makeApprover, submitDraft } from "../support/decision-fixtures";
import {
  auditRows,
  levelOf,
  reserve,
  variantIdsBySku,
} from "../support/stock-fixtures";

jest.setTimeout(10 * 60 * 1000);

type Row = Record<string, any>;

const unique = (label: string) => `${label}-${randomUUID().slice(0, 5)}`;

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("vendor stock per location", () => {
      let vendorA: ActiveVendor;
      let vendorB: ActiveVendor;
      let categoryId: string;
      let publishableKey: string;
      let approver: Awaited<ReturnType<typeof makeApprover>>;

      const put = (headers: Record<string, string>, updates: unknown[]) =>
        probe(api, headers, "PUT", "/vendor/inventory", { updates });

      const approved = async (vendor: ActiveVendor, label: string) => {
        const draft = await approveViaApi(api, getContainer(), approver.headers, vendor, categoryId, unique(label));
        const ids = await variantIdsBySku(getContainer(), draft.productId);
        return { draft, variantS: String(ids.get(`${draft.suffix}-S`)), variantM: String(ids.get(`${draft.suffix}-M`)) };
      };

      beforeAll(async () => {
        const container = getContainer();
        // Default channel first so vendor locations and the publishable key share it;
        // otherwise Store `inventory_quantity` stays undefined.
        await ensureDefaultSalesChannel(container);
        vendorA = await createActiveVendor(api, container, {
          label: "stock-a",
          extraLocations: [{ state_code: "IN-KA", pin: "560001" }],
        });
        vendorB = await createActiveVendor(api, container, { label: "stock-b" });
        categoryId = await createCategory(container, { name: "Stock Apparel" });
        publishableKey = await createPublishableKey(container);
        approver = await makeApprover(api, container);
      });

      it("sets stock per owned location and audits each change", async () => {
        const container = getContainer();
        const { draft, variantS } = await approved(vendorA, "s1");
        const [locA, locB] = vendorA.locations;

        const response = await put(vendorA.headers, [
          { variant_id: variantS, location_code: locA.code, stocked_quantity: 10 },
          { variant_id: variantS, location_code: locB.code, stocked_quantity: 5 },
        ]);
        expect(response.status).toBe(200);

        expect((await levelOf(container, variantS, locA.stock_location_id))?.stocked).toBe(10);
        expect((await levelOf(container, variantS, locB.stock_location_id))?.stocked).toBe(5);

        const store = await storeGet(
          api,
          publishableKey,
          `/store/products/${draft.productId}?fields=id,%2Bvariants.inventory_quantity`
        );
        const variant = ((store.data.product?.variants ?? []) as Row[]).find((item) => item.id === variantS);
        expect(variant?.inventory_quantity).toBe(15);

        const entry = await waitForAuditEntry(
          container,
          (row) =>
            row.action === "stock.updated" &&
            (row.meta as Row | null)?.variant_id === variantS &&
            (row.meta as Row | null)?.location === locA.code
        );
        expect(entry).not.toBeNull();
        expect((entry?.before as Row).stocked_quantity).toBe(0);
        expect((entry?.after as Row).stocked_quantity).toBe(10);
        expect(entry?.actor_type).toBe("vendor");
        expect(entry?.actor_id).toBe(vendorA.user_id);
        const second = await waitForAuditEntry(
          container,
          (row) =>
            row.action === "stock.updated" &&
            (row.meta as Row | null)?.variant_id === variantS &&
            (row.meta as Row | null)?.location === locB.code
        );
        expect((second?.before as Row).stocked_quantity).toBe(0);
        expect((second?.after as Row).stocked_quantity).toBe(5);
      });

      it("updates one level and writes no entry for an unchanged value", async () => {
        const container = getContainer();
        const { variantS } = await approved(vendorA, "s2");
        const [locA, locB] = vendorA.locations;
        await put(vendorA.headers, [
          { variant_id: variantS, location_code: locA.code, stocked_quantity: 10 },
          { variant_id: variantS, location_code: locB.code, stocked_quantity: 5 },
        ]);

        expect((await put(vendorA.headers, [{ variant_id: variantS, location_code: locA.code, stocked_quantity: 7 }])).status).toBe(200);
        expect((await levelOf(container, variantS, locA.stock_location_id))?.stocked).toBe(7);
        expect((await levelOf(container, variantS, locB.stock_location_id))?.stocked).toBe(5);
        const entries = await auditRows(container, { action: "stock.updated", target_id: variantS });
        const change = entries.find(
          (row) => (row.meta as Row).location === locA.code && (row.after as Row).stocked_quantity === 7
        );
        expect((change?.before as Row).stocked_quantity).toBe(10);

        const before = (await auditRows(container, { action: "stock.updated", target_id: variantS })).length;
        expect((await put(vendorA.headers, [{ variant_id: variantS, location_code: locA.code, stocked_quantity: 7 }])).status).toBe(200);
        expect((await auditRows(container, { action: "stock.updated", target_id: variantS })).length).toBe(before);
      });

      it("refuses a quantity below the reserved quantity and accepts the reserved quantity", async () => {
        const container = getContainer();
        const { variantS } = await approved(vendorA, "s3");
        const [locA] = vendorA.locations;
        await put(vendorA.headers, [{ variant_id: variantS, location_code: locA.code, stocked_quantity: 10 }]);
        await reserve(container, variantS, locA.stock_location_id, 3);

        const refused = await put(vendorA.headers, [{ variant_id: variantS, location_code: locA.code, stocked_quantity: 2 }]);
        expect(refused.status).toBe(400);
        expect(refused.code).toBe("stock_rejected");
        expect((refused.body?.errors as Row[])[0]).toMatchObject({ index: 0, code: "below_reserved", reserved: 3 });
        expect((await levelOf(container, variantS, locA.stock_location_id))?.stocked).toBe(10);

        const accepted = await put(vendorA.headers, [{ variant_id: variantS, location_code: locA.code, stocked_quantity: 3 }]);
        expect(accepted.status).toBe(200);
        expect((await levelOf(container, variantS, locA.stock_location_id))?.stocked).toBe(3);
      });

      it("keeps vendors apart: a foreign variant or location is the same 404", async () => {
        const container = getContainer();
        const a = await approved(vendorA, "s4a");
        const b = await approved(vendorB, "s4b");
        const [locA] = vendorA.locations;
        const [locB] = vendorB.locations;

        const foreignVariant = await put(vendorB.headers, [
          { variant_id: a.variantS, location_code: locB.code, stocked_quantity: 4 },
        ]);
        const foreignLocation = await put(vendorB.headers, [
          { variant_id: b.variantS, location_code: locA.code, stocked_quantity: 4 },
        ]);
        const missing = await put(vendorB.headers, [
          { variant_id: "variant_does_not_exist", location_code: locB.code, stocked_quantity: 4 },
        ]);
        expect(foreignVariant.status).toBe(404);
        expect(foreignLocation.status).toBe(404);
        expect(foreignVariant.code).toBe("not_found");
        expect(foreignLocation.body).toEqual(foreignVariant.body);
        expect(missing.body).toEqual(foreignVariant.body);
        expect(await levelOf(container, a.variantS, locA.stock_location_id)).toBeNull();

        const own = await put(vendorB.headers, [
          { variant_id: b.variantS, location_code: locB.code, stocked_quantity: 4 },
        ]);
        expect(own.status).toBe(200);
      });

      it("accepts stock only for approved, live products", async () => {
        const container = getContainer();
        const [locA] = vendorA.locations;
        const refOf = async (productId: string) =>
          String((await variantIdsBySku(container, productId)).values().next().value);

        const draft = await createDraftFor(api, container, vendorA, categoryId, unique("s5d"));
        const submitted = await submitDraft(api, container, vendorA, categoryId, unique("s5s"));
        const rejected = await submitDraft(api, container, vendorA, categoryId, unique("s5r"));
        const rejectResponse = await probe(
          api,
          approver.headers,
          "POST",
          `/admin/product-reviews/${rejected.submissionId}/reject`,
          { content_hash: rejected.hash, reason: "The photographs show a logo on every item." }
        );
        expect(rejectResponse.status).toBe(200);
        const withdrawn = await approved(vendorA, "s5w");
        expect(
          (await probe(api, vendorA.headers, "POST", `/vendor/products/${withdrawn.draft.productId}/withdraw`)).status
        ).toBe(200);

        for (const variantId of [
          await refOf(draft.productId),
          await refOf(submitted.productId),
          await refOf(rejected.productId),
          withdrawn.variantS,
        ]) {
          const refused = await put(vendorA.headers, [
            { variant_id: variantId, location_code: locA.code, stocked_quantity: 1 },
          ]);
          expect(refused.status).toBe(400);
          expect(refused.code).toBe("stock_rejected");
          expect((refused.body?.errors as Row[])[0].code).toBe("not_approved");
        }

        const live = await approved(vendorA, "s5ok");
        expect((await put(vendorA.headers, [{ variant_id: live.variantS, location_code: locA.code, stocked_quantity: 1 }])).status).toBe(200);
      });

      it("validates the request body strictly", async () => {
        const { variantS } = await approved(vendorA, "s6");
        const [locA] = vendorA.locations;
        const base = { variant_id: variantS, location_code: locA.code, stocked_quantity: 1 };
        const invalid: unknown[][] = [
          [{ ...base, stocked_quantity: -1 }],
          [{ ...base, stocked_quantity: 1_000_001 }],
          [{ ...base, stocked_quantity: 1.5 }],
          [{ ...base, stocked_quantity: "5" }],
          [{ ...base, vendor_id: "x" }],
          [],
          Array.from({ length: 101 }, () => base),
        ];
        for (const updates of invalid) {
          const refused = await put(vendorA.headers, updates);
          expect(refused.status).toBe(400);
          expect(refused.code).toBe("validation_failed");
        }
        const extraRoot = await probe(api, vendorA.headers, "PUT", "/vendor/inventory", {
          updates: [base],
          extra: true,
        });
        expect(extraRoot.code).toBe("validation_failed");

        const duplicate = await put(vendorA.headers, [base, { ...base, stocked_quantity: 2 }]);
        expect(duplicate.status).toBe(400);
        expect(duplicate.code).toBe("stock_rejected");
        expect((duplicate.body?.errors as Row[])[0]).toMatchObject({ index: 1, code: "duplicate_entry" });
      });

      it("changes nothing when one entry of a request is refused", async () => {
        const container = getContainer();
        const { variantS } = await approved(vendorA, "s7");
        const [locA, locB] = vendorA.locations;
        await put(vendorA.headers, [{ variant_id: variantS, location_code: locB.code, stocked_quantity: 5 }]);
        await reserve(container, variantS, locB.stock_location_id, 3);

        const refused = await put(vendorA.headers, [
          { variant_id: variantS, location_code: locA.code, stocked_quantity: 9 },
          { variant_id: variantS, location_code: locB.code, stocked_quantity: 2 },
        ]);
        expect(refused.status).toBe(400);
        expect(await levelOf(container, variantS, locA.stock_location_id)).toBeNull();
        expect((await levelOf(container, variantS, locB.stock_location_id))?.stocked).toBe(5);
      });

      it("lists the caller's live variants with a level per owned location", async () => {
        const container = getContainer();
        const { draft, variantS, variantM } = await approved(vendorA, "s8");
        const hidden = await createDraftFor(api, container, vendorA, categoryId, unique("s8hidden"));
        const [locA, locB] = vendorA.locations;
        await put(vendorA.headers, [
          { variant_id: variantS, location_code: locA.code, stocked_quantity: 6 },
          { variant_id: variantS, location_code: locB.code, stocked_quantity: 20 },
        ]);
        await reserve(container, variantS, locA.stock_location_id, 2);

        const list = await probe(
          api,
          vendorA.headers,
          "GET",
          `/vendor/inventory?q=${encodeURIComponent(String(draft.body.title))}`
        );
        expect(list.status).toBe(200);
        const body = list.body as Row;
        expect(body.count).toBe(2);
        expect(body.low_stock_threshold).toBe(5);
        expect((body.locations as Row[]).map((location) => location.code)).toEqual([locA.code, locB.code]);
        const rows = body.variants as Row[];
        expect(rows.map((row) => row.vendor_sku).sort()).toEqual([`${draft.suffix}-M`, `${draft.suffix}-S`]);
        const rowS = rows.find((row) => row.variant_id === variantS) as Row;
        const rowM = rows.find((row) => row.variant_id === variantM) as Row;
        expect(rowS.levels).toEqual([
          { location_code: locA.code, stocked_quantity: 6, reserved_quantity: 2, low_stock: true },
          { location_code: locB.code, stocked_quantity: 20, reserved_quantity: 0, low_stock: false },
        ]);
        expect(rowM.levels.every((level: Row) => level.stocked_quantity === 0)).toBe(true);

        const text = JSON.stringify(body);
        for (const needle of [locA.stock_location_id, vendorA.vendor_id, "metadata", "249.00", "stock_location"]) {
          expect(text).not.toContain(needle);
        }

        const paged = await probe(
          api,
          vendorA.headers,
          "GET",
          `/vendor/inventory?q=${encodeURIComponent(String(draft.body.title))}&limit=1&offset=1`
        );
        expect((paged.body?.variants as Row[]).length).toBe(1);
        expect(paged.body?.count).toBe(2);

        const none = await probe(api, vendorA.headers, "GET", `/vendor/inventory?q=${encodeURIComponent(String(hidden.body.title))}`);
        expect(none.body?.count).toBe(0);
        expect((await probe(api, vendorA.headers, "GET", "/vendor/inventory?limit=51")).status).toBe(400);
      });

      it("refuses suspended, unenrolled, invited and anonymous callers", async () => {
        const container = getContainer();
        const suspended = await createActiveVendor(api, container, { label: "stock-suspended" });
        await suspendVendorWorkflow(container).run({
          input: { vendor_id: suspended.vendor_id, reason: "Suspended by a test", actor: { id: "stock-test" } },
        });
        const unenrolledFixture = await createVendorFixture(container, { label: "stock-unenrolled", status: "active" });
        const unenrolledHeaders = await vendorSession(api, unenrolledFixture, { enrolled: false });
        const invitedFixture = await createVendorFixture(container, { label: "stock-invited", status: "invited" });
        const invitedHeaders = await vendorSession(api, invitedFixture);

        const body = { updates: [{ variant_id: "x", location_code: "LOC-0001", stocked_quantity: 1 }] };
        for (const [headers, expected] of [
          [suspended.headers, 403],
          [unenrolledHeaders, 403],
          [invitedHeaders, 403],
          [{}, 401],
        ] as [Record<string, string>, number][]) {
          expect((await probe(api, headers, "GET", "/vendor/inventory")).status).toBe(expected);
          expect((await probe(api, headers, "PUT", "/vendor/inventory", body)).status).toBe(expected);
        }
      });
    });
  },
});
