import { randomUUID } from "node:crypto";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import { createPublishableKey } from "../helpers/publishable-key";
import { probe, waitForAuditEntry } from "../helpers/staff-users";
import {
  catalogService,
  createActiveVendor,
  createCategory,
  createDraftFor,
  forceApprove,
  queryOf,
  storeGet,
  type ActiveVendor,
} from "../support/catalog-fixtures";

jest.setTimeout(10 * 60 * 1000);

type Emitted = { name: string; data: Record<string, any> };

// Later specs use the real approval workflow; here `forceApprove` stands in for it.
medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("vendor product lifecycle", () => {
      let vendorA: ActiveVendor;
      let vendorB: ActiveVendor;
      let categoryId: string;
      let publishableKey: string;
      const emitted: Emitted[] = [];
      let restoreBus: () => void = () => undefined;

      const post = (vendor: ActiveVendor, path: string, body: Record<string, unknown> = {}) =>
        probe(api, vendor.headers, "POST", path, body);
      const detail = (vendor: ActiveVendor, id: string) =>
        probe(api, vendor.headers, "GET", `/vendor/products/${id}`);
      const productOf = (result: { body: unknown }) =>
        (result.body as { product: Record<string, any> }).product;
      const codeOf = (result: { body: unknown }) => (result.body as { code: string }).code;

      const core = async (id: string) => {
        const { data } = await queryOf(getContainer()).graph({
          entity: "product",
          fields: ["id", "title", "status", "sales_channels.id"],
          filters: { id },
        });
        return data[0];
      };
      const submissionOf = async (productId: string) =>
        (
          (await catalogService(getContainer()).listProductSubmissions(
            { product_id: productId },
            { take: 1 }
          )) as any[]
        )[0];
      const storeProduct = (id: string) =>
        storeGet(api, publishableKey, `/store/products/${id}?fields=id,title`);
      const submittedEvents = (productId: string) =>
        emitted.filter((e) => e.name === "catalog.submitted" && e.data?.product_id === productId);

      beforeAll(async () => {
        const container = getContainer();
        vendorA = await createActiveVendor(api, container, { label: "lifecycle-a" });
        vendorB = await createActiveVendor(api, container, { label: "lifecycle-b" });
        categoryId = await createCategory(container, { name: "Lifecycle Demo" });
        publishableKey = await createPublishableKey(container);

        // Event bus spy: records the name and data of every emitted event.
        const bus = container.resolve(Modules.EVENT_BUS) as unknown as {
          emit: (messages: unknown, options?: unknown) => Promise<unknown>;
        };
        const original = bus.emit.bind(bus);
        bus.emit = async (messages: unknown, options?: unknown) => {
          for (const message of ([] as Emitted[]).concat(messages as never)) {
            emitted.push({ name: (message as any).name, data: (message as any).data });
          }
          return original(messages, options);
        };
        restoreBus = () => {
          bus.emit = original;
        };
      });

      afterAll(() => restoreBus());

      it("edits a draft directly and keeps it hidden", async () => {
        const draft = await createDraftFor(api, getContainer(), vendorA, categoryId, "l1");
        const before = await submissionOf(draft.productId);
        expect(before.revision).toBe(1);

        const edited = await post(vendorA, `/vendor/products/${draft.productId}`, {
          ...draft.body,
          title: "Edited Draft Title",
        });
        expect(edited.status).toBe(200);
        expect(productOf(edited).revision).toBe(2);
        expect((await core(draft.productId)).title).toBe("Edited Draft Title");
        const after = await submissionOf(draft.productId);
        expect(after.revision).toBe(2);
        expect(after.content_hash).not.toBe(before.content_hash);
        expect((await storeProduct(draft.productId)).status).toBe(404);
      });

      it("locks a product in review and treats rejection as final", async () => {
        const container = getContainer();
        const draft = await createDraftFor(api, container, vendorA, categoryId, "l2");
        expect((await post(vendorA, `/vendor/products/${draft.productId}/submit`)).status).toBe(200);
        const locked = await post(vendorA, `/vendor/products/${draft.productId}`, {
          ...draft.body,
          title: "Edit During Review",
        });
        expect(locked.status).toBe(409);
        expect(codeOf(locked)).toBe("locked_in_review");

        const other = await createDraftFor(api, container, vendorA, categoryId, "l2-rejected");
        const submission = await submissionOf(other.productId);
        await catalogService(container).updateProductSubmissions({
          id: submission.id,
          state: "rejected",
          is_live: false,
        });
        const attempts = [
          await post(vendorA, `/vendor/products/${other.productId}`, other.body),
          await post(vendorA, `/vendor/products/${other.productId}/submit`),
          await post(vendorA, `/vendor/products/${other.productId}/withdraw`),
        ];
        for (const attempt of attempts) {
          expect(attempt.status).toBe(409);
          expect(codeOf(attempt)).toBe("rejected_final");
        }
      });

      it("submits a draft for review without publishing it", async () => {
        const container = getContainer();
        const draft = await createDraftFor(api, container, vendorA, categoryId, "l3");
        const submitted = await post(vendorA, `/vendor/products/${draft.productId}/submit`);
        expect(submitted.status).toBe(200);
        expect(productOf(submitted).state).toBe("submitted");
        expect((await core(draft.productId)).status).toBe("proposed");
        const list = await storeGet(api, publishableKey, "/store/products?fields=id&limit=100");
        expect((list.data.products as any[]).some((p) => p.id === draft.productId)).toBe(false);
        expect((await storeProduct(draft.productId)).status).toBe(404);
        const events = submittedEvents(draft.productId);
        expect(events).toHaveLength(1);
        expect(events[0].data.live).toBe(false);

        // Content that no longer passes the schema is refused with the issues listed.
        const broken = await createDraftFor(api, container, vendorA, categoryId, "l3-broken");
        await updateProductsWorkflow(container).run({
          input: { selector: { id: broken.productId }, update: { title: "x".repeat(151) } as never },
        });
        const refused = await post(vendorA, `/vendor/products/${broken.productId}/submit`);
        expect(refused.status).toBe(400);
        expect(codeOf(refused)).toBe("incomplete_content");
        expect((refused.body as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
        expect((await submissionOf(broken.productId)).state).toBe("draft");
      });

      it("keeps a live product selling while an edit waits for review", async () => {
        const container = getContainer();
        const draft = await createDraftFor(api, container, vendorA, categoryId, "l4");
        await forceApprove(container, draft.productId);
        const originalTitle = draft.body.title as string;
        const baseline = await storeProduct(draft.productId);
        expect(baseline.status).toBe(200);
        expect(baseline.data.product.title).toBe(originalTitle);

        const proposed = {
          ...draft.body,
          title: "Proposed New Title",
          variants: [{ ...draft.body.variants[0], payout_price: "249.00" }, draft.body.variants[1]],
        };
        const edited = await post(vendorA, `/vendor/products/${draft.productId}`, proposed);
        expect(edited.status).toBe(200);
        const view = productOf(edited);
        expect(view.state).toBe("submitted");
        expect(view.is_live).toBe(true);
        expect(view.has_pending).toBe(true);

        // Neither core nor the Store API changed, and the product is still listed.
        expect((await core(draft.productId)).title).toBe(originalTitle);
        const after = await storeProduct(draft.productId);
        expect(after.status).toBe(200);
        expect(after.data.product.title).toBe(originalTitle);
        const list = await storeGet(api, publishableKey, "/store/products?fields=id&limit=100");
        expect((list.data.products as any[]).some((p) => p.id === draft.productId)).toBe(true);

        // The pending revision is the full proposed content, not a patch.
        const submission = await submissionOf(draft.productId);
        const pending = submission.pending_changes;
        expect(pending.title).toBe("Proposed New Title");
        for (const key of ["images", "options", "variants", "declaration", "proposed_category_id"]) {
          expect(pending[key]).toBeDefined();
        }
        expect(pending.variants).toHaveLength(2);
        expect(submittedEvents(draft.productId).some((e) => e.data.live === true)).toBe(true);
      });

      it("keeps a single pending revision and lets the vendor discard it", async () => {
        const container = getContainer();
        const draft = await createDraftFor(api, container, vendorA, categoryId, "l5");
        await forceApprove(container, draft.productId);
        const live = await submissionOf(draft.productId);

        const first = await post(vendorA, `/vendor/products/${draft.productId}`, {
          ...draft.body,
          title: "First Pending Title",
        });
        expect(first.status).toBe(200);
        const second = await post(vendorA, `/vendor/products/${draft.productId}`, {
          ...draft.body,
          title: "Second Pending Title",
        });
        expect(second.status).toBe(200);
        const pending = await submissionOf(draft.productId);
        expect(pending.pending_changes.title).toBe("Second Pending Title");
        expect(pending.revision).toBe(live.revision + 2);

        const discarded = await post(vendorA, `/vendor/products/${draft.productId}/discard-changes`);
        expect(discarded.status).toBe(200);
        const view = productOf(discarded);
        expect(view.state).toBe("approved");
        expect(view.has_pending).toBe(false);
        const restored = await submissionOf(draft.productId);
        expect(restored.pending_changes ?? null).toBeNull();
        expect(restored.content_hash).toBe(live.content_hash);

        const plain = await createDraftFor(api, container, vendorA, categoryId, "l5-plain");
        const refused = await post(vendorA, `/vendor/products/${plain.productId}/discard-changes`);
        expect(refused.status).toBe(409);
        expect(codeOf(refused)).toBe("invalid_transition");
      });

      it("refuses an edit that changes nothing", async () => {
        const container = getContainer();
        const draft = await createDraftFor(api, container, vendorA, categoryId, "l6");
        await forceApprove(container, draft.productId);
        const same = await post(vendorA, `/vendor/products/${draft.productId}`, draft.body);
        expect(same.status).toBe(400);
        expect(codeOf(same)).toBe("no_changes");
        const submission = await submissionOf(draft.productId);
        expect(submission.pending_changes ?? null).toBeNull();
        expect(submission.state).toBe("approved");
      });

      it("refuses removing a variant that holds stock or a reservation", async () => {
        const container = getContainer();
        const draft = await createDraftFor(api, container, vendorA, categoryId, "l7");
        await forceApprove(container, draft.productId);
        const skuS = "l7-S";
        const skuM = "l7-M";
        const refs = (await catalogService(container).listVendorVariantRefs(
          { product_id: draft.productId, vendor_sku: skuS },
          { take: 1 }
        )) as any[];
        const { data } = await queryOf(container).graph({
          entity: "product_variant",
          fields: ["id", "inventory_items.inventory_item_id"],
          filters: { id: refs[0].variant_id },
        });
        const itemId = data[0].inventory_items[0].inventory_item_id as string;
        const locationId = vendorA.locations[0].stock_location_id;
        const inventory = container.resolve(Modules.INVENTORY) as any;

        const withoutS = {
          ...draft.body,
          options: [{ title: "Size", values: ["M"] }],
          variants: [draft.body.variants[1]],
        };

        // Stock above zero: refused, and only the removed variant's SKU is listed.
        await inventory.createInventoryLevels([
          { inventory_item_id: itemId, location_id: locationId, stocked_quantity: 3 },
        ]);
        const refusedStock = await post(vendorA, `/vendor/products/${draft.productId}`, withoutS);
        expect(refusedStock.status).toBe(409);
        expect(codeOf(refusedStock)).toBe("variant_has_stock_or_orders");
        const message = (refusedStock.body as { message: string }).message;
        expect(message).toContain(skuS);
        expect(message).not.toContain(skuM);

        // No stock and no reservation: accepted into the pending revision.
        await inventory.updateInventoryLevels([
          { inventory_item_id: itemId, location_id: locationId, stocked_quantity: 0 },
        ]);
        const accepted = await post(vendorA, `/vendor/products/${draft.productId}`, withoutS);
        expect(accepted.status).toBe(200);
        expect(productOf(accepted).has_pending).toBe(true);
        expect(
          (await post(vendorA, `/vendor/products/${draft.productId}/discard-changes`)).status
        ).toBe(200);

        // A reservation with zero stock still blocks the removal. Core refuses a
        // reservation against zero stock, so stock 1, reserve 1, then stocked back to 0.
        await inventory.updateInventoryLevels([
          { inventory_item_id: itemId, location_id: locationId, stocked_quantity: 1 },
        ]);
        const [reservation] = await inventory.createReservationItems([
          { inventory_item_id: itemId, location_id: locationId, quantity: 1 },
        ]);
        await inventory.updateInventoryLevels([
          { inventory_item_id: itemId, location_id: locationId, stocked_quantity: 0 },
        ]);
        const refusedReservation = await post(vendorA, `/vendor/products/${draft.productId}`, withoutS);
        expect(refusedReservation.status).toBe(409);
        expect(codeOf(refusedReservation)).toBe("variant_has_stock_or_orders");
        await inventory.deleteReservationItems([reservation.id]);
      });

      it("withdraws a live product and hides it everywhere", async () => {
        const container = getContainer();
        const draft = await createDraftFor(api, container, vendorA, categoryId, "l8");
        await forceApprove(container, draft.productId);
        expect((await storeProduct(draft.productId)).status).toBe(200);

        const withdrawn = await post(vendorA, `/vendor/products/${draft.productId}/withdraw`);
        expect(withdrawn.status).toBe(200);
        const view = productOf(withdrawn);
        expect(view.state).toBe("withdrawn");
        expect(view.is_live).toBe(false);
        const product = await core(draft.productId);
        expect(product.status).toBe("draft");
        expect(product.sales_channels ?? []).toHaveLength(0);
        expect((await storeProduct(draft.productId)).status).toBe(404);
        const list = await storeGet(api, publishableKey, "/store/products?fields=id&limit=100");
        expect((list.data.products as any[]).some((p) => p.id === draft.productId)).toBe(false);

        const entry = await waitForAuditEntry(
          container,
          (row) => row.action === "product.withdrawn" && row.target_id === draft.productId
        );
        expect(entry).not.toBeNull();
        const text = JSON.stringify(entry);
        expect(text).toContain("approved");
        expect(text).toContain("withdrawn");
        expect(text).not.toContain(draft.body.title as string);

        // A draft cannot be withdrawn, and a withdrawn product can be resubmitted.
        const plain = await createDraftFor(api, container, vendorA, categoryId, "l8-plain");
        const refused = await post(vendorA, `/vendor/products/${plain.productId}/withdraw`);
        expect(refused.status).toBe(409);
        expect(codeOf(refused)).toBe("invalid_transition");

        const resubmitted = await post(vendorA, `/vendor/products/${draft.productId}/submit`);
        expect(resubmitted.status).toBe(200);
        expect(productOf(resubmitted).state).toBe("submitted");
        expect((await core(draft.productId)).status).toBe("proposed");
      });

      it("never lets a vendor action publish a product", async () => {
        const container = getContainer();
        const allowed = ["draft", "proposed"];

        const draft = await createDraftFor(api, container, vendorA, categoryId, "l9");
        const statuses: string[] = [];
        const record = async () => statuses.push((await core(draft.productId)).status);
        await record();
        await post(vendorA, `/vendor/products/${draft.productId}`, { ...draft.body, title: "L9 Edit" });
        await record();
        await post(vendorA, `/vendor/products/${draft.productId}/submit`);
        await record();
        await post(vendorA, `/vendor/products/${draft.productId}/withdraw`);
        await record();
        await post(vendorA, `/vendor/products/${draft.productId}/submit`);
        await record();
        for (const status of statuses) {
          expect(allowed).toContain(status);
        }

        // A force-approved product keeps the status staff gave it through live edits and discards.
        const live = await createDraftFor(api, container, vendorA, categoryId, "l9-live");
        await forceApprove(container, live.productId);
        await post(vendorA, `/vendor/products/${live.productId}`, { ...live.body, title: "L9 Live Edit" });
        expect((await core(live.productId)).status).toBe("published");
        await post(vendorA, `/vendor/products/${live.productId}/discard-changes`);
        expect((await core(live.productId)).status).toBe("published");
      });

      it("answers 404 to another vendor on every product action and changes nothing", async () => {
        const container = getContainer();
        const sharedSuffix = `l10-${randomUUID().slice(0, 4)}`;
        const mine = await createDraftFor(api, container, vendorA, categoryId, sharedSuffix);
        const live = await createDraftFor(api, container, vendorA, categoryId, `${sharedSuffix}-live`);
        await forceApprove(container, live.productId);
        await post(vendorA, `/vendor/products/${live.productId}`, { ...live.body, title: "L10 Pending" });
        const own = await createDraftFor(api, container, vendorB, categoryId, sharedSuffix);
        expect(own.result.status).toBe(201);

        const snapshots = async () => ({
          mine: await submissionOf(mine.productId),
          live: await submissionOf(live.productId),
          title: (await core(mine.productId)).title,
        });
        const before = await snapshots();

        const attempts = [
          post(vendorB, `/vendor/products/${mine.productId}`, mine.body),
          post(vendorB, `/vendor/products/${mine.productId}/submit`),
          post(vendorB, `/vendor/products/${live.productId}/withdraw`),
          post(vendorB, `/vendor/products/${live.productId}/discard-changes`),
        ];
        for (const attempt of await Promise.all(attempts)) {
          expect(attempt.status).toBe(404);
        }
        const after = await snapshots();
        expect(after.mine.state).toBe(before.mine.state);
        expect(after.mine.revision).toBe(before.mine.revision);
        expect(after.live.state).toBe(before.live.state);
        expect(after.live.revision).toBe(before.live.revision);
        expect(after.title).toBe(before.title);

        // Vendor B's own product with the same SKU values is untouched.
        const ownView = await detail(vendorB, own.productId);
        expect(productOf(ownView).state).toBe("draft");
        expect(productOf(ownView).revision).toBe(1);
      });
    });
  },
});
