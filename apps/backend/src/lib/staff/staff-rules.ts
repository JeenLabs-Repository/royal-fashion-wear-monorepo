// The rules for changing roles, as pure functions over plain data so they can be
// tested without Medusa. The workflow steps load the data, call these, and turn
// a failure into a MedusaError with the type named here.

import { validateRoleCombination } from "../rbac/access";
import { ROLE_KEYS } from "../rbac/permissions";

/** Names of MedusaError.Types entries. */
export type RuleErrorType = "CONFLICT" | "NOT_ALLOWED" | "INVALID_DATA" | "NOT_FOUND";

export type RuleFailure = { ok: false; code: string; type: RuleErrorType; message: string };
export type RuleResult = { ok: true } | RuleFailure;

const fail = (code: string, type: RuleErrorType, message: string): RuleFailure => ({
  ok: false,
  code,
  type,
  message,
});

const BREAK_GLASS_MESSAGE =
  "The break-glass account is protected. Change it from the server command line.";

export function planAssign(input: {
  currentRoles: readonly string[];
  role: string;
  isBreakGlass: boolean;
}): RuleResult {
  if (input.isBreakGlass) {
    return fail("break_glass_protected", "NOT_ALLOWED", BREAK_GLASS_MESSAGE);
  }
  if (!(ROLE_KEYS as readonly string[]).includes(input.role)) {
    return fail("unknown_role", "INVALID_DATA", "That role does not exist.");
  }
  if (input.currentRoles.includes(input.role)) {
    return fail("already_assigned", "INVALID_DATA", "This user already has that role.");
  }
  if (validateRoleCombination([...input.currentRoles, input.role]) === "superadmin_exclusive") {
    return fail(
      "superadmin_exclusive",
      "NOT_ALLOWED",
      "Superadmin cannot be combined with another role."
    );
  }
  return { ok: true };
}

export function planRevoke(input: {
  currentRoles: readonly string[];
  role: string;
  isBreakGlass: boolean;
  /** Non-break-glass superadmins other than the target whose user still exists. */
  otherSuperadminCount: number;
}): RuleResult {
  if (input.isBreakGlass) {
    return fail("break_glass_protected", "NOT_ALLOWED", BREAK_GLASS_MESSAGE);
  }
  if (!input.currentRoles.includes(input.role)) {
    return fail("not_assigned", "NOT_FOUND", "This user does not have that role.");
  }
  if (input.role === "superadmin" && input.otherSuperadminCount === 0) {
    return fail(
      "last_superadmin",
      "CONFLICT",
      "This is the last superadmin. Make another user a superadmin first."
    );
  }
  return { ok: true };
}
