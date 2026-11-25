import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { processImage } from "../../../lib/images/process-image";
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
  const { result } = await vendorRecordUploadWorkflow(req.scope).run({
    input: {
      vendor_id: vendor.id,
      vendor_user_id: vendor.user_id,
      vendor_label: vendor.user_email,
      image_base64: processed.data.toString("base64"),
    },
  });
  res.status(200).json({ upload: uploadSerializer.serialize(result) });
}
