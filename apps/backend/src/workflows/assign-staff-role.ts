// Gives a user one role. Only the admin route runs this, after the permission
// chain has checked that the caller holds staff:manage.
//
// The shared staff-assignments lock serialises this with every other role
// change and with the user-delete guard, so the last-superadmin rule cannot be
// raced. acquireLockStep / releaseLockStep are exported from core-flows on
// 2.22.7 with input { key, timeout, ttl } in seconds.

import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { recordAuditStep } from "../lib/audit/record-audit-step";
import { STAFF_ASSIGNMENTS_LOCK_KEY } from "../lib/rbac/guards";
import { createStaffAssignmentStep } from "./steps/staff-assignment-steps";
import { validateAssignStaffRoleStep } from "./steps/staff-validation-steps";

export type StaffWorkflowActor = {
  id: string;
  /** `user` for a signed-in staff member, `system` for a server script. */
  type: "user" | "system";
  label: string | null;
};

export type AssignStaffRoleInput = {
  user_id: string;
  role: string;
  actor: StaffWorkflowActor;
};

export const assignStaffRoleWorkflow = createWorkflow(
  "assign-staff-role",
  function (input: AssignStaffRoleInput) {
    acquireLockStep({ key: STAFF_ASSIGNMENTS_LOCK_KEY, timeout: 10, ttl: 30 });

    const current = validateAssignStaffRoleStep({ user_id: input.user_id, role: input.role });

    createStaffAssignmentStep(
      transform({ input }, ({ input }) => ({
        user_id: input.user_id,
        role_key: input.role,
        assigned_by: input.actor.id,
      }))
    );

    const roles = transform({ current, input }, ({ current, input }) =>
      [...current.roles, input.role].sort()
    );

    recordAuditStep(
      transform({ input, current, roles }, (data) => ({
        action: "staff.role_assigned" as const,
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

export default assignStaffRoleWorkflow;
