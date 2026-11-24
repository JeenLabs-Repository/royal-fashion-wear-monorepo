// Checks the permission the matched manifest rule asks for. A route with no
// rule asks for superadmin: default deny.

import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import { evaluateAccess, type ManifestPermission } from "./access";
import { adminLocals, getLogger, rejectRequest, type AdminRequest } from "./reject";

export function requireManifestPermission(
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  const locals = adminLocals(res);
  const staff = locals.staff;
  if (!staff) {
    // The staff context step must have set this. Never fall through without it.
    rejectRequest(res, {
      status: 500,
      code: "staff_lookup_failed",
      type: "unexpected_state",
      message: "Could not check access. Try again.",
    });
    return;
  }

  const rule = locals.adminRoute?.rule ?? null;
  const required: ManifestPermission = rule ? rule.permission : "superadmin";

  if (required !== "self" && staff.roleKeys.length === 0) {
    rejectRequest(res, {
      status: 403,
      code: "no_staff_role",
      message: "Your account has no role yet. Ask a superadmin to assign one.",
    });
    return;
  }
  const allowed = evaluateAccess(
    { roleKeys: staff.roleKeys, permissions: staff.permissions },
    required,
    { authenticated: true }
  );
  if (!allowed) {
    getLogger(req).warn(
      `[admin-access] denied user=${staff.userId} method=${req.method} route=${
        rule ? rule.pattern : "unmatched"
      } required=${required}`
    );
    rejectRequest(res, {
      status: 403,
      code: "permission_denied",
      message: "You do not have permission to do this.",
    });
    return;
  }
  next();
}
