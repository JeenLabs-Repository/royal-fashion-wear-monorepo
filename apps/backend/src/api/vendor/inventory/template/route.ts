import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { TEMPLATE_BODY } from "../../../../lib/stock/csv-export";
import { requireVendor } from "../../../../lib/vendor/vendor-context";

// The same file for every vendor, so the name carries nothing about the caller.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  requireVendor(req);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="stock-template.csv"');
  res.send(TEMPLATE_BODY);
}
