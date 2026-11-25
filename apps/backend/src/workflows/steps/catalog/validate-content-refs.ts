import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import type { ContentSnapshot } from "../../../lib/catalog/content-snapshot";
import { catalogError } from "../../../lib/catalog/errors";
import { getCatalogService, getQuery } from "../../../lib/catalog/load-content";
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
    const strayVariantIds = content.variants.flatMap((variant, index) =>
      variant.variant_id
        ? [{ path: `variants.${index}.variant_id`, message: "A new product cannot name existing variants." }]
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
      if (upload.product_id) {
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
    const clashes = taken;
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
