// Takes one role from a user. The last non-break-glass superadmin cannot lose
// superadmin, and the break-glass account cannot be changed at all; both rules
// live in staff-rules.ts and run under the shared staff-assignments lock.

import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { recordAuditStep } from "../lib/audit/record-audit-step";
import { STAFF_ASSIGNMENTS_LOCK_KEY } from "../lib/rbac/guards";
import { deleteStaffAssignmentStep } from "./steps/staff-assignment-steps";
import { validateRevokeStaffRoleStep } from "./steps/staff-validation-steps";
import type { StaffWorkflowActor } from "./assign-staff-role";

export type RevokeStaffRoleInput = {
  user_id: string;
  role: string;
  actor: StaffWorkflowActor;
};

export const revokeStaffRoleWorkflow = createWorkflow(
  "revoke-staff-role",
  function (input: RevokeStaffRoleInput) {
    acquireLockStep({ key: STAFF_ASSIGNMENTS_LOCK_KEY, timeout: 10, ttl: 30 });

    const current = validateRevokeStaffRoleStep({ user_id: input.user_id, role: input.role });

    deleteStaffAssignmentStep(
      transform({ input }, ({ input }) => ({ user_id: input.user_id, role_key: input.role }))
    );

    const roles = transform({ current, input }, ({ current, input }) =>
      current.roles.filter((role) => role !== input.role).sort()
    );

    recordAuditStep(
      transform({ input, current, roles }, (data) => ({
        action: "staff.role_revoked" as const,
        actor: {
          id: data.input.actor.id,
          type: data.input.actor.type,
          label: data.input.actor.label,
          roles: [],
        },
        target: { type: "user", id: data.input.user_id },
        before: { roles: [...data.current.roles].sort() },
        after: { roles: data.roles },
      }))
    );

    releaseLockStep({ key: STAFF_ASSIGNMENTS_LOCK_KEY });

    return new WorkflowResponse(roles);
  }
);

export default revokeStaffRoleWorkflow;
