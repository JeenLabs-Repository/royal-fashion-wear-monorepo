import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { buildExportCsv } from "../../../../lib/stock/csv-export";
import { requireVendor } from "../../../../lib/vendor/vendor-context";

// Only the caller's own live variants and locations are read. The file name is fixed.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const vendor = requireVendor(req);
  const body = await buildExportCsv(req.scope, vendor.id);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="stock-export.csv"');
  res.send(body);
}
