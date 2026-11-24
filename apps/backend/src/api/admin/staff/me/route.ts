import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { isMfaEnrolled } from "../../../../lib/mfa";
import type { StaffLocals } from "../../../../lib/rbac/reject";

// Open to any signed-in staff user, including one with no role: the admin pages
// ask this route who they are talking to and render a no-access state from it.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const staff = res.locals.staff as StaffLocals | undefined;
  if (!staff) {
    // The chain sets this for every admin request. Never answer without it.
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Staff context missing",
      "staff_lookup_failed"
    );
  }

  const users = req.scope.resolve<IUserModuleService>(Modules.USER);
  const [user] = await users.listUsers(
    { id: [staff.userId] },
    { select: ["id", "email", "first_name", "last_name"] }
  );

  res.json({
    user_id: staff.userId,
    email: user?.email ?? null,
    first_name: user?.first_name ?? null,
    last_name: user?.last_name ?? null,
    roles: staff.roleKeys,
    permissions: [...staff.permissions].sort(),
    is_break_glass: staff.isBreakGlass,
    access: staff.roleKeys.length > 0 ? "granted" : "no_role",
    mfa_enabled: isMfaEnrolled(req.auth_context),
  });
}
