import { randomUUID } from "node:crypto";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows";
import { slugifyTitle } from "../../src/lib/catalog/ids";
import { toTwoDecimals } from "../../src/lib/catalog/load-content";
import { readInrPrices } from "../../src/workflows/steps/catalog/decision-steps";
import { suspendVendorWorkflow } from "../../src/workflows/vendors/suspend-vendor";
import { createPublishableKey } from "../helpers/publishable-key";
import { probe, waitForAuditEntry } from "../helpers/staff-users";
import { ensureDefaultSalesChannel } from "../helpers/vendor-fixtures";
import {
  catalogService,
  createActiveVendor,
  createCategory,
  queryOf,
  storeGet,
  type ActiveVendor,
} from "../support/catalog-fixtures";
import {
  approveBodyFor,
  currentHash,
  FULL_CHECKLIST,
  makeApprover,
  readSubmission,
  submitDraft,
  type SubmittedDraft,
} from "../support/decision-fixtures";

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

type Row = Record<string, any>;

const SKU_PATTERN = /^PL-\d{8}$/;
const HANDLE_PATTERN = /^[a-z0-9-]+-[a-z2-7]{5}$/;

const unique = (label: string) => `${label}-${randomUUID().slice(0, 5)}`;

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("product review decisions", () => {
      let vendorA: ActiveVendor;
      let categoryId: string;
      let publishableKey: string;
      let approver: Awaited<ReturnType<typeof makeApprover>>;

      const readCore = async (productId: string): Promise<Row> => {
        const { data } = await queryOf(getContainer()).graph({
          entity: "product",
          fields: [
            "id",
            "handle",
            "title",
            "status",
            "metadata",
            "origin_country",
            "type.value",
            "sales_channels.id",
            "variants.id",
            "variants.sku",
            "variants.hs_code",
          ],
          filters: { id: productId },
        });
        return data[0];
      };

      // Everything an approval writes, as one comparable value.
      const fingerprint = async (productId: string): Promise<string> => {
        const core = await readCore(productId);
        const prices = [...(await readInrPrices(getContainer(), productId)).entries()].sort();
        return JSON.stringify({ core, prices });
      };

      const decide = (submissionId: string, action: string, body: Record<string, unknown>) =>
        probe(api, approver.headers, "POST", `/admin/product-reviews/${submissionId}/${action}`, body);

      const approve = (draft: SubmittedDraft, overrides: Record<string, unknown> = {}) =>
        decide(draft.submissionId, "approve", approveBodyFor(draft, categoryId, overrides));

      // A product approved through the real route, so its variants have SKUs and prices.
      const approvedProduct = async (label: string): Promise<SubmittedDraft> => {
        const draft = await submitDraft(api, getContainer(), vendorA, categoryId, unique(label));
        const response = await approve(draft);
        expect(response.status).toBe(200);
        return draft;
      };

      const vendorEdit = (draft: SubmittedDraft, content: Row) =>
        probe(api, vendorA.headers, "POST", `/vendor/products/${draft.productId}`, content);

      const editedContent = (draft: SubmittedDraft): Row => ({
        ...draft.body,
        title: `${draft.body.title} Updated`,
        options: [{ title: "Size", values: ["S", "L"] }],
        variants: [
          { ...draft.body.variants[0], payout_price: "189.00" },
          {
            vendor_sku: `${draft.suffix}-L`,
            option_values: { Size: "L" },
            payout_price: "219.00",
            mrp: "329.00",
            net_quantity_value: 1,
            net_quantity_unit: "pcs",
            weight_g: 270,
          },
        ],
      });

      beforeAll(async () => {
        const container = getContainer();
        vendorA = await createActiveVendor(api, container, { label: "decisions-a" });
        categoryId = await createCategory(container, { name: "Decisions Apparel" });
        publishableKey = await createPublishableKey(container);
        approver = await makeApprover(api, container);
        await ensureDefaultSalesChannel(container);
      });

      it("approves a submitted draft with platform identifiers and customer prices", async () => {
        const container = getContainer();
        const draft = await submitDraft(api, container, vendorA, categoryId, unique("t1"));

        const response = await approve(draft);
        expect(response.status).toBe(200);

        const core = await readCore(draft.productId);
        const skus = (core.variants as Row[]).map((variant) => String(variant.sku));
        expect(skus).toHaveLength(2);
        skus.forEach((sku) => expect(sku).toMatch(SKU_PATTERN));
        expect(new Set(skus).size).toBe(2);
        expect(core.handle).toMatch(HANDLE_PATTERN);
        expect(String(core.handle).startsWith(slugifyTitle(String(draft.body.title)))).toBe(true);
        expect(core.status).toBe("published");
        expect(core.type.value).toBe("GST-5");
        expect((core.variants as Row[]).every((variant) => variant.hs_code === "6109")).toBe(true);
        expect(core.origin_country).toBe("IN");
        expect(core.metadata ?? {}).toEqual({});

        const channelId = await ensureDefaultSalesChannel(container);
        expect((core.sales_channels as Row[]).map((channel) => channel.id)).toContain(channelId);

        const prices = [...(await readInrPrices(container, draft.productId)).values()].sort();
        expect(prices).toEqual(["249.00", "259.50"]);

        const submission = await readSubmission(container, draft.productId);
        expect(submission.state).toBe("approved");
        expect(submission.is_live).toBe(true);
        expect(submission.approved_content_hash).toBe(draft.hash);

        // What customers can read holds neither the vendor SKU, the vendor id nor the upload id.
        const list = await storeGet(api, publishableKey, `/store/products?handle=${core.handle}&fields=id,handle,title`);
        expect(list.status).toBe(200);
        expect((list.data.products as Row[]).map((product) => product.handle)).toEqual([core.handle]);
        const detail = await storeGet(api, publishableKey, `/store/products/${draft.productId}`);
        const text = JSON.stringify([list.data, detail.data]);
        for (const needle of [`${draft.suffix}-S`, `${draft.suffix}-M`, vendorA.vendor_id, draft.uploadId]) {
          expect(text).not.toContain(needle);
        }

        const { data: regions } = await queryOf(container).graph({
          entity: "region",
          fields: ["id", "currency_code"],
        });
        const inr = regions.find((region) => String(region.currency_code).toLowerCase() === "inr");
        if (inr) {
          const priced = await storeGet(
            api,
            publishableKey,
            `/store/products?handle=${core.handle}&region_id=${inr.id}&fields=id,*variants.calculated_price`
          );
          const amounts = ((priced.data.products[0]?.variants ?? []) as Row[])
            .map((variant) => Number(variant.calculated_price?.calculated_amount))
            .sort((x, y) => x - y);
          expect(amounts).toEqual([249, 259.5]);
        }
      });

      it("refuses an incomplete checklist, bad prices and bad classification without changing core", async () => {
        const container = getContainer();
        const draft = await submitDraft(api, container, vendorA, categoryId, unique("t2"));
        const before = await fingerprint(draft.productId);
        const skuS = String(draft.body.variants[0].vendor_sku);
        const skuM = String(draft.body.variants[1].vendor_sku);

        for (const checklist of [
          { ...FULL_CHECKLIST, no_watermark_or_logo: false },
          { no_identifying_text: true, no_watermark_or_logo: true },
        ]) {
          const refused = await approve(draft, { checklist });
          expect(refused.status).toBe(400);
          expect(refused.code).toBe("checklist_incomplete");
        }
        const noChecklist = await decide(draft.submissionId, "approve", {
          ...approveBodyFor(draft, categoryId),
          checklist: undefined,
        });
        expect(noChecklist.code).toBe("checklist_incomplete");

        const missingPrice = await approve(draft, { prices: [{ vendor_sku: skuS, selling_price: "249.00" }] });
        expect(missingPrice.status).toBe(400);
        expect(missingPrice.code).toBe("price_missing");

        const unknownSku = await approve(draft, {
          prices: [
            { vendor_sku: skuS, selling_price: "249.00" },
            { vendor_sku: skuM, selling_price: "259.50" },
            { vendor_sku: "nope-1", selling_price: "10.00" },
          ],
        });
        expect(unknownSku.status).toBe(400);

        const aboveMrp = await approve(draft, {
          prices: [
            { vendor_sku: skuS, selling_price: "299.01" },
            { vendor_sku: skuM, selling_price: "259.50" },
          ],
        });
        expect(aboveMrp.status).toBe(400);
        expect(aboveMrp.code).toBe("price_above_mrp");
        expect(aboveMrp.body?.sku).toBe(skuS);

        expect((await approve(draft, { gst_class: "not_sure" })).status).toBe(400);
        expect((await approve(draft, { hsn: "61" })).status).toBe(400);

        const inactive = await createCategory(container, { name: unique("Inactive"), is_active: false });
        const inactiveCategory = await approve(draft, { category_id: inactive });
        expect(inactiveCategory.status).toBe(400);
        expect(inactiveCategory.code).toBe("unknown_category");

        expect(await fingerprint(draft.productId)).toBe(before);
        expect((await readSubmission(container, draft.productId)).state).toBe("submitted");

        // A price equal to the MRP is accepted.
        const atMrp = await approve(draft, {
          prices: [
            { vendor_sku: skuS, selling_price: "299.00" },
            { vendor_sku: skuM, selling_price: "319.00" },
          ],
        });
        expect(atMrp.status).toBe(200);
        expect([...(await readInrPrices(container, draft.productId)).values()].sort()).toEqual([
          "299.00",
          "319.00",
        ]);
      });

      it("refuses an approval of content that changed after the page was opened", async () => {
        const container = getContainer();

        const draft = await submitDraft(api, container, vendorA, categoryId, unique("t3a"));
        const edit = await probe(
          api,
          approver.headers,
          "POST",
          `/admin/product-reviews/${draft.submissionId}/content`,
          { expected_hash: draft.hash, title: `${draft.body.title} Reworded` }
        );
        expect(edit.status).toBe(200);
        const stale = await approve(draft);
        expect(stale.status).toBe(409);
        expect(stale.code).toBe("stale_revision");
        const fresh = await currentHash(container, draft.submissionId);
        expect(fresh).not.toBe(draft.hash);
        expect((await approve({ ...draft, hash: fresh })).status).toBe(200);

        const live = await approvedProduct("t3b");
        const edited = await vendorEdit(live, editedContent(live));
        expect(edited.status).toBe(200);
        const pendingHash = await currentHash(container, live.submissionId);
        const again = await vendorEdit(live, {
          ...editedContent(live),
          title: `${live.body.title} Changed Twice`,
        });
        expect(again.status).toBe(200);
        const staleLive = await decide(live.submissionId, "approve", {
          ...approveBodyFor({ body: live.body, hash: pendingHash }, categoryId),
          prices: [{ vendor_sku: `${live.suffix}-L`, selling_price: "259.00" }],
        });
        expect(staleLive.status).toBe(409);
        expect(staleLive.code).toBe("stale_revision");
      });

      it("writes the checklist, hash, classification, prices and approver edits to the audit entry", async () => {
        const container = getContainer();
        const draft = await submitDraft(api, container, vendorA, categoryId, unique("t4"));
        const edit = await probe(
          api,
          approver.headers,
          "POST",
          `/admin/product-reviews/${draft.submissionId}/content`,
          { expected_hash: draft.hash, title: `${draft.body.title} Edited` }
        );
        expect(edit.status).toBe(200);
        const hash = await currentHash(container, draft.submissionId);

        const response = await approve({ ...draft, hash });
        expect(response.status).toBe(200);

        const entry = await waitForAuditEntry(
          container,
          (row) => row.action === "product.approved" && row.target_id === draft.productId
        );
        expect(entry).not.toBeNull();
        expect(entry?.actor_type).toBe("user");
        expect(entry?.actor_id).toBe(approver.id);
        const after = entry?.after as Row;
        expect(after.checklist).toEqual(FULL_CHECKLIST);
        expect(after.content_hash).toBe(hash);
        expect(after.gst_class).toBe("GST-5");
        expect(after.hsn).toBe("6109");
        expect(after.category_id).toBe(categoryId);
        const platformSkus = Object.keys(after.selling_prices as Row);
        expect(platformSkus).toHaveLength(2);
        platformSkus.forEach((sku) => expect(sku).toMatch(SKU_PATTERN));
        expect(Object.values(after.selling_prices as Row).sort()).toEqual(["249.00", "259.50"]);
        const edits = (entry?.meta as Row).approver_edits as Row[];
        expect(edits.map((item) => item.field)).toContain("title");
      });

      it("applies a live edit without changing the handle or the existing SKUs", async () => {
        const container = getContainer();
        const draft = await approvedProduct("t5a");
        const before = await readCore(draft.productId);
        const refs = await catalogService(container).listVendorVariantRefs(
          { product_id: draft.productId },
          { take: null }
        );
        const skuBySku = new Map(
          (before.variants as Row[]).map((variant) => [String(variant.id), String(variant.sku)])
        );
        const variantS = String(
          (refs as Row[]).find((ref) => ref.vendor_sku === draft.body.variants[0].vendor_sku)?.variant_id
        );

        expect((await vendorEdit(draft, editedContent(draft))).status).toBe(200);
        const row = await readSubmission(container, draft.productId);
        const approveEdit = await decide(draft.submissionId, "approve", {
          ...approveBodyFor({ body: draft.body, hash: await currentHash(container, String(row.id)) }, categoryId),
          prices: [{ vendor_sku: `${draft.suffix}-L`, selling_price: "259.00" }],
        });
        expect(approveEdit.status).toBe(200);

        const after = await readCore(draft.productId);
        expect(after.title).toBe(`${draft.body.title} Updated`);
        expect(after.handle).toBe(before.handle);
        expect(after.status).toBe("published");
        expect((after.variants as Row[]).find((variant) => variant.id === variantS)?.sku).toBe(
          skuBySku.get(variantS)
        );
        expect(after.variants as Row[]).toHaveLength(2);
        const skus = (after.variants as Row[]).map((variant) => String(variant.sku));
        skus.forEach((sku) => expect(sku).toMatch(SKU_PATTERN));
        expect(new Set(skus).size).toBe(2);

        const prices = await readInrPrices(container, draft.productId);
        const newRef = (await catalogService(container).listVendorVariantRefs(
          { product_id: draft.productId, vendor_sku: `${draft.suffix}-L` },
          { take: 1 }
        )) as Row[];
        expect(prices.get(String(newRef[0].variant_id))).toBe("259.00");
        expect(prices.get(variantS)).toBe("249.00");

        const refS = (await catalogService(container).listVendorVariantRefs(
          { product_id: draft.productId, vendor_sku: draft.body.variants[0].vendor_sku },
          { take: 1 }
        )) as Row[];
        expect(toTwoDecimals(refS[0].raw_payout_price ?? refS[0].payout_price)).toBe("189.00");

        const submission = await readSubmission(container, draft.productId);
        expect(submission.state).toBe("approved");
        expect(submission.pending_changes ?? null).toBeNull();
        const entry = await waitForAuditEntry(
          container,
          (item) => item.action === "product.changes_applied" && item.target_id === draft.productId
        );
        expect((entry?.after as Row).checklist).toEqual(FULL_CHECKLIST);

        // A new variant without a price is refused and nothing changes.
        const noPrice = await approvedProduct("t5b");
        expect((await vendorEdit(noPrice, editedContent(noPrice))).status).toBe(200);
        const noPriceRow = await readSubmission(container, noPrice.productId);
        const fingerprintBefore = await fingerprint(noPrice.productId);
        const missing = await decide(noPrice.submissionId, "approve", {
          ...approveBodyFor({ body: noPrice.body, hash: await currentHash(container, String(noPriceRow.id)) }, categoryId),
          prices: [],
        });
        expect(missing.status).toBe(400);
        expect(missing.code).toBe("price_missing");
        expect(await fingerprint(noPrice.productId)).toBe(fingerprintBefore);

        // Stock that appears on a variant to be removed blocks the approval.
        const stocked = await approvedProduct("t5c");
        const onlyS = {
          ...stocked.body,
          options: [{ title: "Size", values: ["S"] }],
          variants: [stocked.body.variants[0]],
        };
        expect((await vendorEdit(stocked, onlyS)).status).toBe(200);
        const stockedRow = await readSubmission(container, stocked.productId);
        const [refM] = (await catalogService(container).listVendorVariantRefs(
          { product_id: stocked.productId, vendor_sku: stocked.body.variants[1].vendor_sku },
          { take: 1 }
        )) as Row[];
        const { data: variantRows } = await queryOf(container).graph({
          entity: "product_variant",
          fields: ["id", "inventory_items.inventory_item_id"],
          filters: { id: refM.variant_id },
        });
        await createInventoryLevelsWorkflow(container).run({
          input: {
            inventory_levels: [
              {
                inventory_item_id: variantRows[0].inventory_items[0].inventory_item_id,
                location_id: vendorA.locations[0].stock_location_id,
                stocked_quantity: 5,
              },
            ],
          },
        });
        const blocked = await decide(stocked.submissionId, "approve", {
          ...approveBodyFor({ body: stocked.body, hash: await currentHash(container, String(stockedRow.id)) }, categoryId),
          prices: [],
        });
        expect(blocked.status).toBe(409);
        expect(blocked.code).toBe("variant_has_stock_or_orders");
      });

      it("rejects and requests changes with a reason, for new products and live edits", async () => {
        const container = getContainer();

        const tooShort = await submitDraft(api, container, vendorA, categoryId, unique("t6a"));
        const short = await decide(tooShort.submissionId, "reject", {
          content_hash: tooShort.hash,
          reason: "123456789",
        });
        expect(short.status).toBe(400);
        expect(short.code).toBe("reason_too_short");

        // Request changes on a new product: draft, editable, resubmittable, then approvable.
        const changes = await decide(tooShort.submissionId, "request-changes", {
          content_hash: tooShort.hash,
          reason: "Remove the studio name from the description.",
        });
        expect(changes.status).toBe(200);
        let submission = await readSubmission(container, tooShort.productId);
        expect(submission.state).toBe("changes_requested");
        expect(submission.reason).toBe("Remove the studio name from the description.");
        expect((await readCore(tooShort.productId)).status).toBe("draft");
        expect((await vendorEdit(tooShort, { ...tooShort.body, description: "Plain cotton t-shirt." })).status).toBe(200);
        const resubmitted = await probe(
          api,
          vendorA.headers,
          "POST",
          `/vendor/products/${tooShort.productId}/submit`
        );
        expect(resubmitted.status).toBe(200);
        submission = await readSubmission(container, tooShort.productId);
        expect(
          (await approve({ ...tooShort, hash: await currentHash(container, String(submission.id)) })).status
        ).toBe(200);

        // Reject a new product: final.
        const doomed = await submitDraft(api, container, vendorA, categoryId, unique("t6b"));
        const rejected = await decide(doomed.submissionId, "reject", {
          content_hash: doomed.hash,
          reason: "The photographs show a logo on every item.",
        });
        expect(rejected.status).toBe(200);
        expect((await readSubmission(container, doomed.productId)).state).toBe("rejected");
        expect((await readCore(doomed.productId)).status).toBe("rejected");
        const afterReject = await vendorEdit(doomed, { ...doomed.body, description: "Another try." });
        expect(afterReject.status).toBe(409);
        expect(afterReject.code).toBe("rejected_final");

        // Reject a live edit: the live product keeps selling unchanged.
        const live = await approvedProduct("t6c");
        const liveBefore = await storeGet(api, publishableKey, `/store/products/${live.productId}`);
        expect((await vendorEdit(live, editedContent(live))).status).toBe(200);
        const pendingRow = await readSubmission(container, live.productId);
        const rejectedEdit = await decide(live.submissionId, "reject", {
          content_hash: await currentHash(container, String(pendingRow.id)),
          reason: "The new title names a brand we do not carry.",
        });
        expect(rejectedEdit.status).toBe(200);
        const afterRow = await readSubmission(container, live.productId);
        expect(afterRow.state).toBe("approved");
        expect(afterRow.is_live).toBe(true);
        expect(afterRow.pending_changes ?? null).toBeNull();
        expect(afterRow.reason).toBe("The new title names a brand we do not carry.");
        const liveAfter = await storeGet(api, publishableKey, `/store/products/${live.productId}`);
        expect(liveAfter.data.product.title).toBe(liveBefore.data.product.title);

        // Request changes on a live edit: live unchanged, the vendor can edit the pending revision.
        expect((await vendorEdit(live, editedContent(live))).status).toBe(200);
        const secondPending = await readSubmission(container, live.productId);
        const requested = await decide(live.submissionId, "request-changes", {
          content_hash: await currentHash(container, String(secondPending.id)),
          reason: "Keep the old title and fix the new variant name.",
        });
        expect(requested.status).toBe(200);
        expect((await readSubmission(container, live.productId)).state).toBe("changes_requested");
        const liveStill = await storeGet(api, publishableKey, `/store/products/${live.productId}`);
        expect(liveStill.data.product.title).toBe(liveBefore.data.product.title);
        expect(
          (await vendorEdit(live, { ...editedContent(live), title: `${live.body.title} Again` })).status
        ).toBe(200);

        const rejectedAudit = await waitForAuditEntry(
          container,
          (row) => row.action === "product.rejected" && row.target_id === doomed.productId
        );
        expect((rejectedAudit?.after as Row).reason).toBe("The photographs show a logo on every item.");
        const changesAudit = await waitForAuditEntry(
          container,
          (row) => row.action === "product.changes_requested" && row.target_id === tooShort.productId
        );
        expect((changesAudit?.after as Row).reason).toBe("Remove the studio name from the description.");
      });

      it("blocks ineligible vendors and serialises concurrent decisions", async () => {
        const container = getContainer();

        const suspended = await createActiveVendor(api, container, { label: "decisions-suspended" });
        const suspendedDraft = await submitDraft(api, container, suspended, categoryId, unique("t7a"));
        await suspendVendorWorkflow(container).run({
          input: { vendor_id: suspended.vendor_id, reason: "Suspended by a test", actor: { id: "decision-test" } },
        });
        const refusedSuspended = await approve(suspendedDraft);
        expect(refusedSuspended.status).toBe(409);
        expect(refusedSuspended.code).toBe("vendor_not_eligible");

        const stale = await createActiveVendor(api, container, { label: "decisions-stale" });
        const staleDraft = await submitDraft(api, container, stale, categoryId, unique("t7b"));
        mockSettings.current_agreement_version = "v2-test";
        try {
          const refusedStale = await approve(staleDraft);
          expect(refusedStale.status).toBe(409);
          expect(refusedStale.code).toBe("vendor_not_eligible");
        } finally {
          mockSettings.current_agreement_version = "v1-draft";
        }

        // Two simultaneous approvals: one wins, one set of SKUs.
        const race = await submitDraft(api, container, vendorA, categoryId, unique("t7c"));
        const results = await Promise.all([approve(race), approve(race)]);
        expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
        const raced = await readCore(race.productId);
        expect((raced.variants as Row[]).map((variant) => String(variant.sku))).toHaveLength(2);

        // Five products approved at once receive distinct, gap-free SKU numbers.
        const drafts: SubmittedDraft[] = [];
        for (let index = 0; index < 5; index += 1) {
          drafts.push(await submitDraft(api, container, vendorA, categoryId, unique(`t7d${index}`)));
        }
        const approvals = await Promise.all(drafts.map((draft) => approve(draft)));
        expect(approvals.map((result) => result.status)).toEqual([200, 200, 200, 200, 200]);
        const numbers: number[] = [];
        for (const draft of drafts) {
          for (const variant of (await readCore(draft.productId)).variants as Row[]) {
            numbers.push(Number(String(variant.sku).slice(3)));
          }
        }
        expect(new Set(numbers).size).toBe(10);
        numbers.sort((x, y) => x - y);
        expect(numbers[numbers.length - 1] - numbers[0]).toBe(9);
      });
    });
  },
});
