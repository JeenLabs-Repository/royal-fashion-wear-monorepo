import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { contentHash, type ContentSnapshot } from "../../../lib/catalog/content-snapshot";
import {
  contentVariantPairs,
  getCatalogService,
  loadLiveSnapshotByProduct,
  pairsKey,
} from "../../../lib/catalog/load-content";
import type { DraftProduct } from "./create-draft-product";

export type CreateSubmissionInput = {
  vendor_id: string;
  content: ContentSnapshot;
  product: DraftProduct;
};

type Created = {
  submission_id?: string;
  ref_ids: string[];
  declaration_id?: string;
  upload_ids: string[];
};

// Removes whatever was created, newest first. Used on a failure inside the step and as the
// compensation of the step.
async function removeCreated(scope: MedusaContainer, created: Created): Promise<void> {
  const service = getCatalogService(scope);
  if (created.submission_id) {
    await service.deleteProductSubmissions([created.submission_id]);
  }
  if (created.declaration_id) {
    await service.deleteProductDeclarations([created.declaration_id]);
  }
  if (created.ref_ids.length > 0) {
    await service.deleteVendorVariantRefs(created.ref_ids);
  }
  if (created.upload_ids.length > 0) {
    await service.updateVendorUploads(created.upload_ids.map((id) => ({ id, product_id: null })));
  }
}

/**
 * Creates the vendor-owned rows of a draft: the submission, one vendor reference per core
 * variant, the declaration, and the upload ownership marks.
 */
export const createSubmissionStep = createStep(
  "create-submission",
  async (input: CreateSubmissionInput, { container }) => {
    const service = getCatalogService(container);
    const { vendor_id: vendorId, content, product } = input;
    const created: Created = { ref_ids: [], upload_ids: [] };

    try {
      const uploadIds = content.images.map((image) => image.upload_id);
      await service.updateVendorUploads(uploadIds.map((id) => ({ id, product_id: product.id })));
      created.upload_ids = uploadIds;

      const variantByKey = new Map(product.variants.map((variant) => [variant.key, variant.id]));
      const refs = content.variants.map((variant) => {
        const variantId = variantByKey.get(pairsKey(contentVariantPairs(content, variant)));
        if (!variantId) {
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            "A created variant does not match the request."
          );
        }
        return {
          variant_id: variantId,
          product_id: product.id,
          vendor_id: vendorId,
          vendor_sku: variant.vendor_sku,
          payout_price: variant.payout_price,
          mrp: variant.mrp ?? null,
          net_quantity_value: variant.net_quantity_value ?? null,
          net_quantity_unit: variant.net_quantity_unit ?? null,
        };
      });
      // bigNumber columns accept decimal strings; the generated service types them as number.
      const createdRefs = await service.createVendorVariantRefs(refs as never);
      const refList = (Array.isArray(createdRefs) ? createdRefs : [createdRefs]) as {
        id: string;
      }[];
      created.ref_ids = refList.map((ref) => String(ref.id));

      const declarationResult = await service.createProductDeclarations([
        {
          product_id: product.id,
          vendor_id: vendorId,
          generic_name: content.declaration?.generic_name ?? null,
          country_of_origin: content.declaration?.country_of_origin ?? null,
          packed_by_name: content.declaration?.packed_by_name ?? null,
          packed_by_address: content.declaration?.packed_by_address ?? null,
        },
      ] as never);
      const declaration = (
        Array.isArray(declarationResult) ? declarationResult[0] : declarationResult
      ) as { id: string };
      created.declaration_id = String(declaration.id);

      const submissionResult = await service.createProductSubmissions([
        {
          product_id: product.id,
          vendor_id: vendorId,
          state: "draft",
          is_live: false,
          revision: 1,
          // Replaced below with the hash of the content read back from core.
          content_hash: "pending",
          proposed_category_id: content.proposed_category_id,
          proposed_gst_class: content.proposed_gst_class,
          proposed_hsn: content.proposed_hsn ?? null,
        },
      ] as never);
      const submission = (
        Array.isArray(submissionResult) ? submissionResult[0] : submissionResult
      ) as { id: string };
      created.submission_id = String(submission.id);

      const readBack = await loadLiveSnapshotByProduct(container, product.id);
      await service.updateProductSubmissions({
        id: submission.id,
        content_hash: contentHash(readBack),
      });

      return new StepResponse(
        { product_id: product.id, submission_id: String(submission.id) },
        created
      );
    } catch (error) {
      await removeCreated(container, created);
      throw error;
    }
  },
  async (created, { container }) => {
    if (created) {
      await removeCreated(container, created);
    }
  }
);
