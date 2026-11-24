import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access";

type AssignmentRow = {
  id: string;
  user_id: string;
  role_key: string;
  is_break_glass: boolean;
  assigned_by: string | null;
};

type StaffAccessApi = {
  createStaffAssignments(rows: Array<Record<string, unknown>>): Promise<AssignmentRow[]>;
  deleteStaffAssignments(ids: string[]): Promise<unknown>;
  listStaffAssignments(
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<AssignmentRow[]>;
};

export const createStaffAssignmentStep = createStep(
  "create-staff-assignment",
  async (input: { user_id: string; role_key: string; assigned_by: string }, { container }) => {
    const staff = container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);
    const [row] = await staff.createStaffAssignments([
      {
        user_id: input.user_id,
        role_key: input.role_key,
        is_break_glass: false,
        assigned_by: input.assigned_by,
      },
    ]);
    return new StepResponse(row, row.id);
  },
  async (id, { container }) => {
    if (!id) {
      return;
    }
    await container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE).deleteStaffAssignments([id]);
  }
);

export const deleteStaffAssignmentStep = createStep(
  "delete-staff-assignment",
  async (input: { user_id: string; role_key: string }, { container }) => {
    const staff = container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);
    const rows = await staff.listStaffAssignments(
      { user_id: input.user_id, role_key: input.role_key },
      { take: null }
    );
    if (rows.length === 0) {
      return new StepResponse(null, null);
    }
    await staff.deleteStaffAssignments(rows.map((row) => row.id));
    return new StepResponse(rows, rows);
  },
  async (rows, { container }) => {
    if (!rows || rows.length === 0) {
      return;
    }
    // Put back what was removed, with its previous fields.
    await container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE).createStaffAssignments(
      rows.map((row) => ({
        user_id: row.user_id,
        role_key: row.role_key,
        is_break_glass: row.is_break_glass,
        assigned_by: row.assigned_by,
      }))
    );
  }
);
