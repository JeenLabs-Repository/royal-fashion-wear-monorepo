import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { withCatalogErrors } from "../../../../../lib/catalog/errors";
import { EditReviewContentBody } from "../../../../../lib/catalog/middlewares/reviews";
import { serializeReviewDetail } from "../../../../../lib/catalog/review-serializers";
import { adminVendorBody } from "../../../../../lib/vendor/admin-middlewares";
import { editReviewContentWorkflow } from "../../../../../workflows/catalog/edit-review-content";
import { loadReviewDetail } from "../../../../../workflows/steps/catalog/load-review";

export const POST = withCatalogErrors(
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
    const body = adminVendorBody(EditReviewContentBody, req);

    await editReviewContentWorkflow(req.scope).run({
      input: { submission_id: req.params.id, ...body },
    });

    res.json(serializeReviewDetail(await loadReviewDetail(req.scope, req.params.id)));
  }
);
