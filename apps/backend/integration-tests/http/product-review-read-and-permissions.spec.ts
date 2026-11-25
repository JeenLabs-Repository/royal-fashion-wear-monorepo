import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CHECKLIST_KEYS } from "../../src/lib/catalog/review-checklist";
import { VENDOR_CATALOG_MODULE } from "../../src/modules/vendor-catalog";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { adminHeadersFor } from "../helpers/admin-as";
import { createStaffUser, probe, secretApiKeyHeaders, staffHeaders } from "../helpers/staff-users";
import {
  createActiveVendor,
  createCategory,
  createDraftViaApi,
  createUploadRow,
  forceApprove,
  validContent,
} from "../support/catalog-fixtures";

jest.setTimeout(240 * 1000);

type Finish = "draft" | "submitted" | "live_edit" | "changes_requested" | "rejected";

type Seeded = {
  submission_id: string;
  product_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_sku: string;
  title: string;
  upload_ids: string[];
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600 * 1000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const catalog = () => getContainer().resolve(VENDOR_CATALOG_MODULE) as any;

    const coreTitle = async (productId: string): Promise<string | undefined> => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({
        entity: "product",
        fields: ["id", "title"],
        filters: { id: productId },
      });
      return (data as { title: string }[])[0]?.title;
    };

    // The one place that talks to the catalog fixtures. If a fixture signature
    // differs from the assumed one, change this function only.
    async function seed(options: { title?: string; finish: Finish }): Promise<Seeded> {
      const container = getContainer();
      const vendor = await createActiveVendor(api, container, {
        label: `review-${Math.random().toString(36).slice(2, 8)}`,
      });
      const headers = vendor.headers;
      const categoryId = await createCategory(container);
      const uploads = [
        await createUploadRow(container, vendor.vendor_id),
        await createUploadRow(container, vendor.vendor_id),
      ];
      const title = options.title ?? `Review Kurta ${Math.random().toString(36).slice(2, 8)}`;
      const content = validContent({
        uploadIds: uploads.map((upload) => upload.id),
        categoryId,
        overrides: { title },
      });
      const created = await createDraftViaApi(api, headers, content);
      expect(created.status).toBe(201);
      const productId = (created.body as { product: { id: string } }).product.id;

      if (options.finish === "live_edit") {
        await forceApprove(container, productId);
        const edited = await api.post(
          `/vendor/products/${productId}`,
          { ...content, title: `${title} Edited` },
          { headers }
        );
        expect(edited.status).toBe(200);
      } else if (options.finish !== "draft") {
        const submitted = await api.post(`/vendor/products/${productId}/submit`, {}, { headers });
        expect(submitted.status).toBe(200);
      }

      const [submission] = await catalog().listProductSubmissions({ product_id: productId });
      if (options.finish === "changes_requested" || options.finish === "rejected") {
        await catalog().updateProductSubmissions({
          id: submission.id,
          state: options.finish,
          reason: "Please remove the logo from the second image.",
          decided_at: new Date(),
        });
      }

      const [ref] = await catalog().listVendorVariantRefs({ product_id: productId });
      const vendorRow = await getVendorModule(container).retrieveVendor(submission.vendor_id);

      return {
        submission_id: submission.id,
        product_id: productId,
        vendor_id: submission.vendor_id,
        vendor_name: vendorRow.internal_name,
        vendor_sku: ref.vendor_sku,
        title,
        upload_ids: uploads.map((upload) => upload.id),
      };
    }

    const expectNoVendorIdentity = (body: unknown, seeded: Seeded, allowSku: boolean) => {
      const text = JSON.stringify(body);
      expect(text).not.toContain(seeded.vendor_id);
      expect(text).not.toContain(seeded.vendor_name);
      if (!allowSku) {
        expect(text).not.toContain(seeded.vendor_sku);
      }
    };

    describe("product review read and permissions", () => {
      it("puts submissions in the right tabs, oldest first, with paging limits", async () => {
        const container = getContainer();
        const headers = await adminHeadersFor(api, container, "catalog_approver");

        const older = await seed({ title: "Queue Older Kurta", finish: "submitted" });
        const newer = await seed({ title: "Queue Newer Kurta", finish: "submitted" });
        const liveEdit = await seed({ title: "Queue Live Kurta", finish: "live_edit" });
        const changes = await seed({ title: "Queue Changes Kurta", finish: "changes_requested" });
        const rejected = await seed({ title: "Queue Rejected Kurta", finish: "rejected" });

        await catalog().updateProductSubmissions({ id: older.submission_id, submitted_at: hoursAgo(5) });
        await catalog().updateProductSubmissions({ id: newer.submission_id, submitted_at: hoursAgo(1) });

        const list = async (tab: string) => {
          const result = await probe(api, headers, "GET", `/admin/product-reviews?tab=${tab}`);
          expect(result.status).toBe(200);
          return result.body as { reviews: { id: string; title: string }[]; count: number; limit: number };
        };

        const tabNew = await list("new");
        expect(tabNew.reviews.map((row) => row.id)).toEqual([older.submission_id, newer.submission_id]);
        expect(tabNew.limit).toBe(25);

        expect((await list("live_edits")).reviews.map((row) => row.id)).toEqual([liveEdit.submission_id]);
        expect((await list("changes_requested")).reviews.map((row) => row.id)).toEqual([changes.submission_id]);
        expect((await list("rejected")).reviews.map((row) => row.id)).toEqual([rejected.submission_id]);

        const everything = [
          await list("new"),
          await list("live_edits"),
          await list("changes_requested"),
          await list("rejected"),
        ];
        for (const seeded of [older, newer, liveEdit, changes, rejected]) {
          expectNoVendorIdentity(everything, seeded, false);
        }

        const tooMany = await probe(api, headers, "GET", "/admin/product-reviews?tab=new&limit=26");
        expect(tooMany.status).toBe(400);
        const unknownTab = await probe(api, headers, "GET", "/admin/product-reviews?tab=everything");
        expect(unknownTab.status).toBe(400);
        const unknownKey = await probe(api, headers, "GET", "/admin/product-reviews?tab=new&vendor_id=x");
        expect(unknownKey.status).toBe(400);
      });

      it("returns the detail with the live version, the diff and the checklist", async () => {
        const container = getContainer();
        const headers = await adminHeadersFor(api, container, "catalog_approver");

        const fresh = await seed({ title: "Detail Fresh Kurta", finish: "submitted" });
        const freshDetail = await probe(api, headers, "GET", `/admin/product-reviews/${fresh.submission_id}`);
        expect(freshDetail.status).toBe(200);
        const review = (freshDetail.body as any).review;
        expect(review.content.title).toBe("Detail Fresh Kurta");
        expect(review.content.images).toHaveLength(2);
        expect(typeof review.content.images[0].url).toBe("string");
        expect(review.content.variants[0].payout_price).toMatch(/^\d+\.\d{2}$/);
        expect(review.content.declaration).toBeDefined();
        expect(review.live_content).toBeNull();
        expect(review.diff).toEqual([]);
        expect(review.content_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(review.approver_edits).toEqual([]);
        expect(review.display_mode).toBe("hidden");
        expect(review.checklist.map((item: { key: string }) => item.key)).toEqual([...CHECKLIST_KEYS]);
        expect(review.checklist.every((item: { label: string }) => item.label.length > 10)).toBe(true);
        expectNoVendorIdentity(freshDetail.body, fresh, true);

        const edit = await seed({ title: "Detail Live Kurta", finish: "live_edit" });
        const editDetail = await probe(api, headers, "GET", `/admin/product-reviews/${edit.submission_id}`);
        const editReview = (editDetail.body as any).review;
        expect(editReview.tab).toBe("live_edits");
        expect(editReview.live_content.title).toBe("Detail Live Kurta");
        expect(editReview.content.title).toBe("Detail Live Kurta Edited");
        expect(editReview.diff.map((entry: { path: string }) => entry.path)).toContain("title");
        expect(Array.isArray(editReview.live_prices)).toBe(true);
        expectNoVendorIdentity(editDetail.body, edit, true);

        const missing = await probe(api, headers, "GET", "/admin/product-reviews/prsub_missing");
        expect(missing.status).toBe(404);
      });

      it("lets an approver edit text and image order without touching a live product", async () => {
        const container = getContainer();
        const headers = await adminHeadersFor(api, container, "catalog_approver");
        const detailOf = async (id: string) =>
          ((await probe(api, headers, "GET", `/admin/product-reviews/${id}`)).body as any).review;

        // New product: the edit reaches the core product.
        const fresh = await seed({ title: "Edit Fresh Kurta", finish: "submitted" });
        const first = await detailOf(fresh.submission_id);
        const reversed = [...fresh.upload_ids].reverse();

        const edited = await probe(
          api,
          headers,
          "POST",
          `/admin/product-reviews/${fresh.submission_id}/content`,
          {
            expected_hash: first.content_hash,
            title: "<b>Edited Fresh Kurta</b>",
            description: "A new <i>description</i> for the product.",
            image_upload_ids: reversed,
          }
        );
        expect(edited.status).toBe(200);
        const afterFirst = (edited.body as any).review;
        expect(afterFirst.content_hash).not.toBe(first.content_hash);
        expect(afterFirst.content.title).toBe("Edited Fresh Kurta");
        expect(afterFirst.content.description).toBe("A new description for the product.");
        expect(afterFirst.content.images.map((image: { upload_id: string }) => image.upload_id)).toEqual(reversed);
        expect(await coreTitle(fresh.product_id)).toBe("Edited Fresh Kurta");
        expect(afterFirst.approver_edits.map((entry: { field: string }) => entry.field).sort()).toEqual([
          "description",
          "images",
          "title",
        ]);

        // A second edit of the same field keeps the first `before`.
        const second = await probe(
          api,
          headers,
          "POST",
          `/admin/product-reviews/${fresh.submission_id}/content`,
          { expected_hash: afterFirst.content_hash, title: "Second Fresh Kurta" }
        );
        expect(second.status).toBe(200);
        const titleEdit = (second.body as any).review.approver_edits.find(
          (entry: { field: string }) => entry.field === "title"
        );
        expect(titleEdit).toEqual({ field: "title", before: "Edit Fresh Kurta", after: "Second Fresh Kurta" });

        // Stale hash.
        const stale = await probe(
          api,
          headers,
          "POST",
          `/admin/product-reviews/${fresh.submission_id}/content`,
          { expected_hash: first.content_hash, title: "Too Late" }
        );
        expect(stale.status).toBe(409);
        expect(stale.code).toBe("stale_revision");

        // Adding or dropping an image is not a permutation.
        const current = await detailOf(fresh.submission_id);
        const dropped = await probe(
          api,
          headers,
          "POST",
          `/admin/product-reviews/${fresh.submission_id}/content`,
          { expected_hash: current.content_hash, image_upload_ids: [reversed[0]] }
        );
        expect(dropped.status).toBe(400);
        const added = await probe(
          api,
          headers,
          "POST",
          `/admin/product-reviews/${fresh.submission_id}/content`,
          { expected_hash: current.content_hash, image_upload_ids: [...reversed, "upl_not_mine"] }
        );
        expect(added.status).toBe(400);

        // Live edit: the change lands in the pending revision only.
        const live = await seed({ title: "Edit Live Kurta", finish: "live_edit" });
        const liveBefore = await detailOf(live.submission_id);
        const liveEdited = await probe(
          api,
          headers,
          "POST",
          `/admin/product-reviews/${live.submission_id}/content`,
          { expected_hash: liveBefore.content_hash, title: "Approver Title For Live" }
        );
        expect(liveEdited.status).toBe(200);
        expect((liveEdited.body as any).review.content.title).toBe("Approver Title For Live");
        expect((liveEdited.body as any).review.live_content.title).toBe("Edit Live Kurta");
        expect(await coreTitle(live.product_id)).toBe("Edit Live Kurta");

        // Not waiting for review.
        const draft = await seed({ title: "Edit Draft Kurta", finish: "draft" });
        const draftHash = (await detailOf(draft.submission_id)).content_hash;
        const notSubmitted = await probe(
          api,
          headers,
          "POST",
          `/admin/product-reviews/${draft.submission_id}/content`,
          { expected_hash: draftHash, title: "Not Yet" }
        );
        expect(notSubmitted.status).toBe(409);
        expect(notSubmitted.code).toBe("invalid_transition");
      });

      it("limits each route to the right roles and keeps publication out of the core editor", async () => {
        const container = getContainer();
        const seeded = await seed({ title: "Permission Kurta", finish: "submitted" });
        const approver = await adminHeadersFor(api, container, "catalog_approver");
        const hash = (
          (await probe(api, approver, "GET", `/admin/product-reviews/${seeded.submission_id}`)).body as any
        ).review.content_hash as string;
        const editBody = { expected_hash: hash, title: "Permission Probe Kurta" };

        const roles: [string, number, number, number][] = [
          ["order_router", 200, 200, 403],
          ["finance_readonly", 200, 200, 403],
          ["support", 403, 403, 403],
          ["catalog_approver", 200, 200, 200],
        ];
        for (const [role, listStatus, detailStatus, editStatus] of roles) {
          const headers = await adminHeadersFor(api, container, role as any);
          const label = `${role}`;
          expect({ label, status: (await probe(api, headers, "GET", "/admin/product-reviews")).status }).toEqual({
            label,
            status: listStatus,
          });
          expect({
            label,
            status: (await probe(api, headers, "GET", `/admin/product-reviews/${seeded.submission_id}`)).status,
          }).toEqual({ label, status: detailStatus });
          expect({
            label,
            status: (
              await probe(api, headers, "POST", `/admin/product-reviews/${seeded.submission_id}/content`, editBody)
            ).status,
          }).toEqual({ label, status: editStatus });
        }

        const noRole = await createStaffUser(container, { roleKeys: [], mfaEnrolled: true });
        const noRoleHeaders = await staffHeaders(api, noRole);
        expect((await probe(api, noRoleHeaders, "GET", "/admin/product-reviews")).status).toBe(403);

        const superadmin = await adminHeadersFor(api, container, "superadmin");
        const keyHeaders = await secretApiKeyHeaders(api, superadmin);
        const withKey = await probe(api, keyHeaders, "GET", "/admin/product-reviews");
        expect(withKey.status).toBe(403);

        // The core product editor is not an approver path to publication.
        const titleBefore = await coreTitle(seeded.product_id);
        const asApprover = await probe(api, approver, "POST", `/admin/products/${seeded.product_id}`, {
          title: "Published Around Review",
          status: "published",
        });
        expect(asApprover.status).toBe(403);
        expect(await coreTitle(seeded.product_id)).toBe(titleBefore);

        const asSuperadmin = await probe(api, superadmin, "POST", `/admin/products/${seeded.product_id}`, {
          title: "Superadmin Title",
        });
        expect(asSuperadmin.status).toBe(200);

        // The owner-curated category list stays editable by approvers.
        const category = await probe(api, approver, "POST", "/admin/product-categories", {
          name: "Review Spec Category",
        });
        expect(category.status).toBe(200);
      });
    });
  },
});
