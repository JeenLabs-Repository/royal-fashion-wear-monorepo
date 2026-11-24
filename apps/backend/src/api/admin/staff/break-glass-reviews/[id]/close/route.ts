import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { actorFromRequest } from "../../../../../../lib/staff/request-actor";
import { closeBreakGlassReviewWorkflow } from "../../../../../../workflows/close-break-glass-review";

const BodySchema = z.strictObject({
  rotated_confirmed: z.literal(true),
  note: z.string().trim().min(10).max(500),
});

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((issue) => issue.message).join("; "),
      "invalid_body"
    );
  }

  // The closer is the signed-in user, never a value from the body.
  const actor = await actorFromRequest(req);
  const { result } = await closeBreakGlassReviewWorkflow(req.scope).run({
    input: {
      review_id: req.params.id,
      closer: { id: actor.id, label: actor.label },
      rotated_confirmed: parsed.data.rotated_confirmed,
      note: parsed.data.note,
    },
  });

  res.json({ review: result });
}
