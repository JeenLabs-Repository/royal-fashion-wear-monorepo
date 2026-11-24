// Loads who the signed-in caller is and what they may do, fresh on every
// request. There is deliberately no cache: a role change or a deleted user must
// take effect on the very next request.
//
// Two lookups, in this order, both failing closed:
// 1. The user still exists in the user module. A deleted user's session cookie
//    or access token stays cryptographically valid until it expires, so this
//    check is what makes a deletion cut access immediately. It runs before
//    assignments are read, so leftover assignment rows of a deleted user are
//    never consulted (the user id is a random identifier that is never reused,
//    which is why those rows are left in place).
// 2. The role assignments of that user.

import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access";
import { adminLocals, getLogger, rejectRequest, type AdminRequest } from "./reject";

type StaffAccessApi = {
  resolveEffectiveAccess(userId: string): Promise<{
    roleKeys: string[];
    permissions: Iterable<string>;
    isBreakGlass: boolean;
  }>;
};

export async function loadStaffContext(
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const actorId = req.auth_context?.actor_id;
  if (!actorId) {
    rejectUnknownUser(res);
    return;
  }

  let exists: boolean;
  try {
    const users = req.scope.resolve<IUserModuleService>(Modules.USER);
    const found = await users.listUsers({ id: [actorId] }, { select: ["id"] });
    exists = found.length > 0;
  } catch (error) {
    getLogger(req).error(`[staff-context] user lookup failed: ${messageOf(error)}`);
    rejectLookupFailure(res);
    return;
  }
  if (!exists) {
    rejectUnknownUser(res);
    return;
  }

  try {
    const staff = req.scope.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);
    const access = await staff.resolveEffectiveAccess(actorId);
    adminLocals(res).staff = {
      userId: actorId,
      roleKeys: [...access.roleKeys],
      permissions: [...access.permissions].sort(),
      isBreakGlass: access.isBreakGlass,
    };
  } catch (error) {
    getLogger(req).error(`[staff-context] assignment lookup failed: ${messageOf(error)}`);
    rejectLookupFailure(res);
    return;
  }

  next();
}

function rejectUnknownUser(res: MedusaResponse): void {
  rejectRequest(res, {
    status: 401,
    code: "staff_user_not_found",
    type: "unauthorized",
    // Generic on purpose: the response must not say that the account was deleted.
    message: "This sign-in is no longer valid",
  });
}

function rejectLookupFailure(res: MedusaResponse): void {
  rejectRequest(res, {
    status: 500,
    code: "staff_lookup_failed",
    type: "unexpected_state",
    message: "Could not check access. Try again.",
  });
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
