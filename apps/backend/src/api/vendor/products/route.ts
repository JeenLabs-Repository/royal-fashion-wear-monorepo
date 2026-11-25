import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { catalogError, withCatalogErrors } from "../../../lib/catalog/errors";
import type { ContentSnapshot } from "../../../lib/catalog/content-snapshot";
import type { VendorProductsQuery } from "../../../lib/catalog/middlewares/products";
import { readProductDetail, readProductList } from "../../../lib/catalog/serializers";
import { requireVendor } from "../../../lib/vendor/vendor-context";
import { vendorCreateProductWorkflow } from "../../../workflows/catalog/vendor-create-product";

type Validated = { validatedBody?: ContentSnapshot; validatedQuery?: VendorProductsQuery };

export const GET = withCatalogErrors(
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
    const vendor = requireVendor(req);
    const query = (req as unknown as Validated).validatedQuery;
    if (!query) {
      throw catalogError("validation_failed", "The query is not valid.");
    }
    res.json(await readProductList(req.scope, vendor.id, query));
  }
);

export const POST = withCatalogErrors(
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
    const vendor = requireVendor(req);
    const content = (req as unknown as Validated).validatedBody;
    if (!content) {
      throw catalogError("validation_failed", "The body is not valid.");
    }
    const { result } = await vendorCreateProductWorkflow(req.scope).run({
      input: { vendor_id: vendor.id, content },
    });
    res.status(201).json(await readProductDetail(req.scope, vendor.id, result.product_id));
  }
);
