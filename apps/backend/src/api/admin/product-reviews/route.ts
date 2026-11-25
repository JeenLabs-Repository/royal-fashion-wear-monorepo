import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ListReviewsQuery } from "../../../lib/catalog/middlewares/reviews";
import { serializeReviewList } from "../../../lib/catalog/review-serializers";
import { adminVendorQuery } from "../../../lib/vendor/admin-middlewares";
import { loadReviewList } from "../../../workflows/steps/catalog/load-review";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = adminVendorQuery(ListReviewsQuery, req);
  const { items, count } = await loadReviewList(req.scope, query);

  res.json({
    reviews: serializeReviewList(items),
    count,
    limit: query.limit,
    offset: query.offset,
  });
}
