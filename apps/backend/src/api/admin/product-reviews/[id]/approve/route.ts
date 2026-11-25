import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { withDecisionErrors } from "../../../../../lib/catalog/decision-errors";
import { getCatalogService } from "../../../../../lib/catalog/load-content";
import type { ApproveBody } from "../../../../../lib/catalog/middlewares/review-decisions";
import { actorFromRequest } from "../../../../../lib/staff/request-actor";
import { applyLiveEditWorkflow } from "../../../../../workflows/catalog/apply-live-edit";
import { approveProductWorkflow } from "../../../../../workflows/catalog/approve-product";

// The workflow is chosen by the stored live flag, never by the body. The approver is the
// signed-in user. The body was validated in the middleware slot.
export const POST = withDecisionErrors(
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
    const body = (req as unknown as { validatedBody?: ApproveBody }).validatedBody;
    if (!body) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "The body is not valid.");
    }
    const [submission] = await getCatalogService(req.scope).listProductSubmissions(
      { id: req.params.id },
      { take: 1 }
    );
    if (!submission) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
    }
    const actor = await actorFromRequest(req);
    const input = {
      submission_id: String(submission.id),
      actor: { id: actor.id, label: actor.label ?? null },
      body,
    };
    const { result } = submission.is_live
      ? await applyLiveEditWorkflow(req.scope).run({ input })
      : await approveProductWorkflow(req.scope).run({ input });
    res.json({
      review: {
        id: result.submission_id,
        state: result.state,
        is_live: result.is_live,
        revision: result.revision,
      },
    });
  }
);
