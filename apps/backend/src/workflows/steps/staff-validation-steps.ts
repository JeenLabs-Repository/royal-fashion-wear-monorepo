import type { IUserModuleService, MedusaContainer } from "@medusajs/framework/types";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { planAssign, planRevoke, type RuleFailure, type RuleResult } from "../../lib/staff/staff-rules";
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access";

type Assignment = { user_id: string; role_key: string; is_break_glass: boolean };

type StaffAccessApi = {
  listStaffAssignments(
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<Assignment[]>;
  countNonBreakGlassSuperadmins(existingUserIds: string[]): Promise<number>;
};

const toError = (failure: RuleFailure) =>
  new MedusaError(MedusaError.Types[failure.type], failure.message, failure.code);

const assertOk = (result: RuleResult): void => {
  if (!result.ok) {
    throw toError(result);
  }
};

/**
 * Loads the target user, their roles and how many other non-break-glass
 * superadmins remain. An assignment whose user was deleted is ignored here by
 * design: access for a deleted user is already refused on every request, so the
 * leftover rows need no cleanup job.
 */
async function loadTargetContext(container: MedusaContainer, userId: string) {
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const staff = container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);

  const found = await users.listUsers({ id: [userId] }, { select: ["id"] });
  if (found.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "User not found", "user_not_found");
  }

  // take: null lifts the default page size (confirmed in existing staff-access callers).
  const assignments = await staff.listStaffAssignments({ user_id: userId }, { take: null });
  const roles = assignments.map((row) => row.role_key);
  const isBreakGlass = assignments.some((row) => row.is_break_glass);

  const superadmins = await staff.listStaffAssignments(
    { role_key: "superadmin", is_break_glass: false },
    { take: null }
  );
  const candidateIds = [...new Set(superadmins.map((row) => row.user_id))].filter(
    (id) => id !== userId
  );
  const existing = candidateIds.length
    ? (await users.listUsers({ id: candidateIds }, { select: ["id"], take: null })).map((u) => u.id)
    : [];
  const otherSuperadminCount = await staff.countNonBreakGlassSuperadmins(existing);

  return { roles, isBreakGlass, otherSuperadminCount };
}

export const validateAssignStaffRoleStep = createStep(
  "validate-assign-staff-role",
  async (input: { user_id: string; role: string }, { container }) => {
    const context = await loadTargetContext(container, input.user_id);
    assertOk(
      planAssign({
        currentRoles: context.roles,
        role: input.role,
        isBreakGlass: context.isBreakGlass,
      })
    );
    return new StepResponse({ roles: context.roles });
  }
);

export const validateRevokeStaffRoleStep = createStep(
  "validate-revoke-staff-role",
  async (input: { user_id: string; role: string }, { container }) => {
    const context = await loadTargetContext(container, input.user_id);
    assertOk(
      planRevoke({
        currentRoles: context.roles,
        role: input.role,
        isBreakGlass: context.isBreakGlass,
        otherSuperadminCount: context.otherSuperadminCount,
      })
    );
    return new StepResponse({ roles: context.roles });
  }
);
