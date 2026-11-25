import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { processImage } from "../../../lib/images/process-image";
import { rejectRequest } from "../../../lib/rbac/reject";
import { defineAllowlistSerializer } from "../../../lib/serializers";
import { requireVendor } from "../../../lib/vendor/vendor-context";
import { vendorRecordUploadWorkflow } from "../../../workflows/catalog/vendor-record-upload";

type UploadRequest = AuthenticatedMedusaRequest & { file?: { buffer: Buffer } };

// The id is the upload row id, never an owner id.
const uploadSerializer = defineAllowlistSerializer({
  name: "vendor-upload",
  audience: "vendor",
  shape: { id: true, url: true },
});

export async function POST(req: UploadRequest, res: MedusaResponse): Promise<void> {
  // The status guard sets req.vendor from the session. Nothing else names the owner.
  const vendor = requireVendor(req);
  const file = req.file;
  if (!file) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Send the image in the field named file.",
      "file_required"
    );
  }
  // The original file name is never read, logged, stored or passed on.
  const processed = await processImage(file.buffer);
  try {
    const { result } = await vendorRecordUploadWorkflow(req.scope).run({
      input: {
        vendor_id: vendor.id,
        vendor_user_id: vendor.user_id,
        vendor_label: vendor.user_email,
        image_base64: processed.data.toString("base64"),
      },
    });
    res.status(200).json({ upload: uploadSerializer.serialize(result) });
  } catch (error) {
    // Medusa's CONFLICT handler replaces the custom code with invalid_state_error.
    if (MedusaError.isMedusaError(error) && error.code === "too_many_pending_uploads") {
      rejectRequest(res, {
        status: 409,
        code: "too_many_pending_uploads",
        type: "conflict",
        message: error.message,
      });
      return;
    }
    throw error;
  }
}
