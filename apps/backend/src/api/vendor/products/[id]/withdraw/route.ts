import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { withCatalogErrors } from "../../../../../lib/catalog/errors";
import { readProductDetail } from "../../../../../lib/catalog/serializers";
import { requireVendor } from "../../../../../lib/vendor/vendor-context";
import { vendorWithdrawProductWorkflow } from "../../../../../workflows/catalog/vendor-withdraw-product";

export const POST = withCatalogErrors(
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
    const vendor = requireVendor(req);
    await vendorWithdrawProductWorkflow(req.scope).run({
      input: {
        vendor_id: vendor.id,
        product_id: req.params.id,
        actor: { id: vendor.user_id, label: vendor.user_email },
      },
    });
    res.json(await readProductDetail(req.scope, vendor.id, req.params.id));
  }
);
