import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { serializeReviewDetail } from "../../../../lib/catalog/review-serializers";
import { loadReviewDetail } from "../../../../workflows/steps/catalog/load-review";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const detail = await loadReviewDetail(req.scope, req.params.id);
  res.json(serializeReviewDetail(detail));
}
