import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { readCategories } from "../../../lib/catalog/serializers";
import { requireVendor } from "../../../lib/vendor/vendor-context";

// The owner-curated list, read only: id and name of active, non-internal categories.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  requireVendor(req);
  res.json(await readCategories(req.scope));
}
