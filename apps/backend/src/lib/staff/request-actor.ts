import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import type { StaffWorkflowActor } from "../../workflows/assign-staff-role";

/** The audit actor for a signed-in staff member: id from the auth context, never from the body. */
export async function actorFromRequest(
  req: AuthenticatedMedusaRequest
): Promise<StaffWorkflowActor> {
  const id = req.auth_context.actor_id;
  let label: string | null = null;
  try {
    const users = req.scope.resolve<IUserModuleService>(Modules.USER);
    const found = await users.listUsers({ id: [id] }, { select: ["email"] });
    label = found[0]?.email ?? null;
  } catch {
    // The entry is still written, without a label.
  }
  return { id, type: "user", label };
}
