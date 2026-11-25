import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { VENDOR_CATALOG_MODULE } from "../../../modules/vendor-catalog";
import type VendorCatalogService from "../../../modules/vendor-catalog/service";

/** Uploads a vendor may hold that are not attached to any product. */
export const MAX_PENDING_UPLOADS = 100;

const catalogService = (container: MedusaContainer): VendorCatalogService =>
  container.resolve<VendorCatalogService>(VENDOR_CATALOG_MODULE);

/** Throws a 409 conflict with code too_many_pending_uploads at the limit. */
export async function assertUploadCapacity(
  container: MedusaContainer,
  vendorId: string
): Promise<void> {
  const [, count] = await catalogService(container).listAndCountVendorUploads(
    { vendor_id: vendorId, product_id: null },
    { take: 1 }
  );
  if (count >= MAX_PENDING_UPLOADS) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Too many images are waiting to be attached to a product. Use or remove some first.",
      "too_many_pending_uploads"
    );
  }
}

// Checked before the file is stored, so a refusal leaves nothing behind. The
// record step checks again, which keeps the limit honest if the first check is skipped.
export const assertUploadCapacityStep = createStep(
  "assert-vendor-upload-capacity",
  async (input: { vendor_id: string }, { container }) => {
    await assertUploadCapacity(container, input.vendor_id);
    return new StepResponse({ ok: true });
  }
);

export type RecordUploadInput = { vendor_id: string; file_id: string; url: string };

export const recordUploadStep = createStep(
  "record-vendor-upload",
  async (input: RecordUploadInput, { container }) => {
    await assertUploadCapacity(container, input.vendor_id);
    const [row] = await catalogService(container).createVendorUploads([
      { vendor_id: input.vendor_id, file_key: input.file_id, url: input.url },
    ]);
    return new StepResponse({ id: row.id, url: row.url }, row.id);
  },
  async (rowId, { container }) => {
    if (rowId) {
      await catalogService(container).softDeleteVendorUploads([rowId]);
    }
  }
);
