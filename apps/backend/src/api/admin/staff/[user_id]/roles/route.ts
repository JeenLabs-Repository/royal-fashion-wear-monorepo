import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { ROLE_KEYS } from "../../../../../lib/rbac/permissions";
import { actorFromRequest } from "../../../../../lib/staff/request-actor";
import { assignStaffRoleWorkflow } from "../../../../../workflows/assign-staff-role";

const BodySchema = z.strictObject({ role: z.enum(ROLE_KEYS) });

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((issue) => issue.message).join("; "),
      "invalid_body"
    );
  }

  // The target comes from the path and the actor from the auth context, never from the body.
  const userId = req.params.user_id;
  const { result } = await assignStaffRoleWorkflow(req.scope).run({
    input: {
      user_id: userId,
      role: parsed.data.role,
      actor: await actorFromRequest(req),
    },
  });

  res.json({ user_id: userId, roles: result });
}
