import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { applyCsv, scanCsv } from "../../../../lib/stock/csv";
import { stockError, withStockErrors } from "../../../../lib/stock/errors";
import { requireVendor } from "../../../../lib/vendor/vendor-context";

type ImportRequest = AuthenticatedMedusaRequest & { file?: { buffer: Buffer } };

// The file was read into memory by the middleware slot (1 MiB at most). Pass one proves the
// whole file is acceptable and changes nothing; pass two applies it in batches of 100 rows.
export const POST = withStockErrors(async (req: ImportRequest, res: MedusaResponse) => {
  const vendor = requireVendor(req);
  const buffer = req.file?.buffer;
  if (!buffer) {
    throw stockError("file_required", "Send the file in the field named file.");
  }
  await scanCsv(buffer);
  const result = await applyCsv({
    buffer,
    scope: req.scope,
    vendorId: vendor.id,
    actor: { id: vendor.user_id, label: vendor.user_email },
  });
  res.json(result);
});
