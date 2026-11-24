import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listVendorAdminSections } from "../../../../../lib/vendor/admin-sections";
import { adminVendorQuery } from "../../../../../lib/vendor/admin-middlewares";
import { loadVendor } from "../../../../../lib/vendor/eligibility";
import { EmptyQuerySchema } from "../../validators";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  adminVendorQuery(EmptyQuerySchema, req);
  const vendor = await loadVendor(req.scope, req.params.id);
  res.json({ sections: listVendorAdminSections(vendor.id) });
}
