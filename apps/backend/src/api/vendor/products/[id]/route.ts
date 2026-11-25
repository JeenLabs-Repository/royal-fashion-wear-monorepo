import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { withCatalogErrors } from "../../../../lib/catalog/errors";
import { readProductDetail } from "../../../../lib/catalog/serializers";
import { requireVendor } from "../../../../lib/vendor/vendor-context";

// A product id that is unknown and one that belongs to another vendor give the same 404.
export const GET = withCatalogErrors(
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
    const vendor = requireVendor(req);
    res.json(await readProductDetail(req.scope, vendor.id, req.params.id));
  }
);
