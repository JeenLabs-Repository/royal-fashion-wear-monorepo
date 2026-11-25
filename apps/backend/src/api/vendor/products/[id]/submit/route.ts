import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { withCatalogErrors } from "../../../../../lib/catalog/errors";
import { readProductDetail } from "../../../../../lib/catalog/serializers";
import { requireVendor } from "../../../../../lib/vendor/vendor-context";
import { vendorSubmitProductWorkflow } from "../../../../../workflows/catalog/vendor-submit-product";

// Empty strict body (checked in the middleware slot). The vendor comes from the session.
export const POST = withCatalogErrors(
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
    const vendor = requireVendor(req);
    await vendorSubmitProductWorkflow(req.scope).run({
      input: { vendor_id: vendor.id, product_id: req.params.id },
    });
    res.json(await readProductDetail(req.scope, vendor.id, req.params.id));
  }
);
