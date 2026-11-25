import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { withDecisionErrors } from "../../../../../lib/catalog/decision-errors";
import { getCatalogService } from "../../../../../lib/catalog/load-content";
import type { ReasonBody } from "../../../../../lib/catalog/middlewares/review-decisions";
import { actorFromRequest } from "../../../../../lib/staff/request-actor";
import { requestChangesWorkflow } from "../../../../../workflows/catalog/request-changes";

export const POST = withDecisionErrors(
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
    const body = (req as unknown as { validatedBody?: ReasonBody }).validatedBody;
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
    const { result } = await requestChangesWorkflow(req.scope).run({
      input: {
        submission_id: String(submission.id),
        actor: { id: actor.id, label: actor.label ?? null },
        body,
      },
    });
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
