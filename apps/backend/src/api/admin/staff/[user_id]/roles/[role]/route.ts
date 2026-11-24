import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { ROLE_KEYS } from "../../../../../../lib/rbac/permissions";
import { rejectRequest } from "../../../../../../lib/rbac/reject";
import { actorFromRequest } from "../../../../../../lib/staff/request-actor";
import { revokeStaffRoleWorkflow } from "../../../../../../workflows/revoke-staff-role";

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const role = req.params.role;
  if (!(ROLE_KEYS as readonly string[]).includes(role)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "That role does not exist.",
      "unknown_role"
    );
  }

  const userId = req.params.user_id;
  try {
    const { result } = await revokeStaffRoleWorkflow(req.scope).run({
      input: { user_id: userId, role, actor: await actorFromRequest(req) },
    });
    res.json({ user_id: userId, roles: result });
  } catch (error) {
    // Medusa's CONFLICT handler replaces the custom code with invalid_state_error.
    // Re-emit last_superadmin the same way the delete guard does, so callers and
    // tests see the stable code.
    if (
      MedusaError.isMedusaError(error) &&
      error.code === "last_superadmin"
    ) {
      rejectRequest(res, {
        status: 409,
        code: "last_superadmin",
        type: "conflict",
        message: error.message,
      });
      return;
    }
    throw error;
  }
}
