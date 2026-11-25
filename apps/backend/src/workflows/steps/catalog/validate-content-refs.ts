import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import type { ContentSnapshot } from "../../../lib/catalog/content-snapshot";
import { catalogError } from "../../../lib/catalog/errors";
import {
  getCatalogService,
  getQuery,
  loadLiveSnapshotByProduct,
} from "../../../lib/catalog/load-content";
import { assertVendorEligible } from "../../../lib/vendor/eligibility";

// One answer for an unknown upload and another vendor's upload, so the existence of
// other vendors' uploads is not revealed.
const UNKNOWN_UPLOAD_MESSAGE = "Upload not found.";

export type AssertVendorEligibleInput = { vendor_id: string };

/** First step of every vendor write: only an active vendor with the current agreement passes. */
export const assertVendorEligibleStep = createStep(
  "assert-vendor-eligible",
  async (input: AssertVendorEligibleInput, { container }) => {
    try {
      await assertVendorEligible(container, input.vendor_id);
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "vendor_ineligible") {
        throw catalogError("vendor_not_eligible", "This vendor is not eligible to list products yet.");
      }
      throw error;
    }
    return new StepResponse(true);
  }
);

export type ValidateContentRefsInput = {
  vendor_id: string;
  content: ContentSnapshot;
  /** Set when the content belongs to an existing product. */
  product_id?: string;
};

/**
 * Checks everything in a content body that points at other rows: uploads, SKUs, the
 * proposed category. Returns the image URLs in the order of the body.
 */
export const validateContentRefsStep = createStep(
  "validate-content-refs",
  async (input: ValidateContentRefsInput, { container }) => {
    const service = getCatalogService(container);
    const { vendor_id: vendorId, content } = input;

    // variant ids: start
    const ownVariantIds = input.product_id
      ? new Set(
          (
            await service.listVendorVariantRefs({ product_id: input.product_id }, { take: null })
          ).map((ref) => String(ref.variant_id))
        )
      : new Set<string>();
    const strayVariantIds = content.variants.flatMap((variant, index) =>
      variant.variant_id && !ownVariantIds.has(String(variant.variant_id))
        ? [
            {
              path: `variants.${index}.variant_id`,
              message: input.product_id
                ? "A variant does not belong to this product."
                : "A new product cannot name existing variants.",
            },
          ]
        : []
    );
    if (strayVariantIds.length > 0) {
      throw catalogError("validation_failed", "The request is not valid.", { issues: strayVariantIds });
    }
    // variant ids: end

    const uploadIds = content.images.map((image) => image.upload_id);
    const repeated = uploadIds.findIndex((id, index) => uploadIds.indexOf(id) !== index);
    if (repeated >= 0) {
      throw catalogError("validation_failed", "The request is not valid.", {
        issues: [{ path: `images.${repeated}.upload_id`, message: "Each image can be used once." }],
      });
    }
    const uploads = await service.listVendorUploads({ id: uploadIds }, { take: null });
    const byId = new Map(uploads.map((upload) => [String(upload.id), upload]));
    const imageUrls: string[] = [];
    for (const uploadId of uploadIds) {
      const upload = byId.get(uploadId);
      if (!upload || upload.vendor_id !== vendorId) {
        throw catalogError("unknown_upload", UNKNOWN_UPLOAD_MESSAGE);
      }
      if (upload.product_id && upload.product_id !== input.product_id) {
        throw catalogError("upload_already_used", "An image is already used by a product.");
      }
      imageUrls.push(String(upload.url));
    }

    // The check is per vendor: another vendor's SKUs are never read.
    const skus = content.variants.map((variant) => variant.vendor_sku);
    const taken = await service.listVendorVariantRefs(
      { vendor_id: vendorId, vendor_sku: skus },
      { take: null }
    );
    const clashes = taken.filter((ref) => String(ref.product_id) !== input.product_id);
    if (clashes.length > 0) {
      throw catalogError("duplicate_vendor_sku", "A vendor SKU is already used by one of your products.");
    }

    const { data: categories } = await getQuery(container).graph({
      entity: "product_category",
      fields: ["id"],
      filters: { id: content.proposed_category_id, is_active: true, is_internal: false },
    });
    if (categories.length === 0) {
      throw catalogError("unknown_category", "Choose a category from the list.", {
        issues: [{ path: "proposed_category_id", message: "Choose a category from the list." }],
      });
    }

    return new StepResponse(imageUrls);
  }
);

export type UploadOwnershipInput = { product_id: string; upload_ids: string[] };

/** Marks uploads that are not used yet as attached to the product. */
export const attachUploadsStep = createStep(
  "attach-uploads",
  async (input: UploadOwnershipInput, { container }) => {
    const service = getCatalogService(container);
    const rows = await service.listVendorUploads({ id: input.upload_ids }, { take: null });
    const toAttach = rows.filter((row) => !row.product_id).map((row) => String(row.id));
    if (toAttach.length > 0) {
      await service.updateVendorUploads(
        toAttach.map((id) => ({ id, product_id: input.product_id }))
      );
    }
    return new StepResponse(toAttach, toAttach);
  },
  async (attached, { container }) => {
    if (attached && attached.length > 0) {
      await getCatalogService(container).updateVendorUploads(
        attached.map((id) => ({ id, product_id: null }))
      );
    }
  }
);

export type ReleaseUploadsInput = { upload_ids: string[] };

/** Frees uploads so another draft can use them again. */
export const releaseUploadsStep = createStep(
  "release-uploads",
  async (input: ReleaseUploadsInput, { container }) => {
    const service = getCatalogService(container);
    if (input.upload_ids.length === 0) {
      return new StepResponse(0, [] as { id: string; product_id: string }[]);
    }
    const rows = await service.listVendorUploads({ id: input.upload_ids }, { take: null });
    const previous = rows
      .filter((row) => row.product_id)
      .map((row) => ({ id: String(row.id), product_id: String(row.product_id) }));
    await service.updateVendorUploads(previous.map(({ id }) => ({ id, product_id: null })));
    return new StepResponse(previous.length, previous);
  },
  async (previous, { container }) => {
    if (previous && previous.length > 0) {
      await getCatalogService(container).updateVendorUploads(previous);
    }
  }
);

export type PendingOnlyUploadsInput = { product_id: string };

/** Upload ids that appear in the pending revision and not in the live content. */
export const pendingOnlyUploadsStep = createStep(
  "pending-only-uploads",
  async (input: PendingOnlyUploadsInput, { container }) => {
    const [submission] = await getCatalogService(container).listProductSubmissions(
      { product_id: input.product_id },
      { take: 1 }
    );
    const pending = submission?.pending_changes as ContentSnapshot | null | undefined;
    if (!pending) {
      return new StepResponse({ upload_ids: [] as string[] });
    }
    const live = await loadLiveSnapshotByProduct(container, input.product_id);
    const liveIds = new Set(live.images.map((image) => image.upload_id));
    return new StepResponse({
      upload_ids: pending.images.map((image) => image.upload_id).filter((id) => !liveIds.has(id)),
    });
  }
);
