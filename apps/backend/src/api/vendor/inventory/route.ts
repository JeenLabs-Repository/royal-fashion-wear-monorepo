import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import type { PutStockBody, StockQuery } from "../../../lib/catalog/middlewares/inventory";
import { withStockErrors } from "../../../lib/stock/errors";
import { readInventoryPage } from "../../../lib/stock/serializers";
import { requireVendor } from "../../../lib/vendor/vendor-context";
import { setVendorStockWorkflow } from "../../../workflows/stock/set-vendor-stock";

type Validated = { validatedBody?: PutStockBody; validatedQuery?: StockQuery };

export const GET = withStockErrors(async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const vendor = requireVendor(req);
  const query = (req as unknown as Validated).validatedQuery;
  if (!query) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The query is not valid.");
  }
  res.json(await readInventoryPage(req.scope, vendor.id, query));
});

// Absolute stock replace is named PUT, although the backend guidance prefers POST.
export const PUT = withStockErrors(async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const vendor = requireVendor(req);
  const body = (req as unknown as Validated).validatedBody;
  if (!body) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The body is not valid.");
  }
  const entries = body.updates.map((update, index) => ({ index, ...update }));
  const { result } = await setVendorStockWorkflow(req.scope).run({
    input: {
      vendor_id: vendor.id,
      actor: { id: vendor.user_id, label: vendor.user_email },
      entries,
      mode: "strict",
    },
  });
  res.json({
    results: body.updates.map((update, index) => ({
      variant_id: update.variant_id,
      location_code: update.location_code,
      stocked_quantity: update.stocked_quantity,
      status: result.results[index]?.status ?? "unchanged",
    })),
  });
});
