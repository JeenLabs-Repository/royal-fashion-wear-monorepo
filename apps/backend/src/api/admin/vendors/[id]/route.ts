import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { toAdminVendorView } from "../../../../lib/serializers/admin/vendor";
import { adminVendorQuery } from "../../../../lib/vendor/admin-middlewares";
import { loadVendor } from "../../../../lib/vendor/eligibility";
import { EmptyQuerySchema } from "../validators";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  adminVendorQuery(EmptyQuerySchema, req);
  const vendor = await loadVendor(req.scope, req.params.id);
  res.json({ vendor: await toAdminVendorView(req.scope, vendor) });
}
