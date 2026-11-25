import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { ContentSnapshot } from "../../../../lib/catalog/content-snapshot";
import { catalogError, withCatalogErrors } from "../../../../lib/catalog/errors";
import { readProductDetail } from "../../../../lib/catalog/serializers";
import { requireVendor } from "../../../../lib/vendor/vendor-context";
import { vendorUpdateProductWorkflow } from "../../../../workflows/catalog/vendor-update-product";

// A product id that is unknown and one that belongs to another vendor give the same 404.
export const GET = withCatalogErrors(
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
    const vendor = requireVendor(req);
    res.json(await readProductDetail(req.scope, vendor.id, req.params.id));
  }
);

// Update uses POST, like every vendor write. The body is the full content, validated by the
// same strict schema as create.
export const POST = withCatalogErrors(
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
    const vendor = requireVendor(req);
    const content = (req as unknown as { validatedBody?: ContentSnapshot }).validatedBody;
    if (!content) {
      throw catalogError("validation_failed", "The body is not valid.");
    }
    await vendorUpdateProductWorkflow(req.scope).run({
      input: { vendor_id: vendor.id, product_id: req.params.id, content },
    });
    res.json(await readProductDetail(req.scope, vendor.id, req.params.id));
  }
);
