import { model } from "@medusajs/framework/utils";

// One row per user and role. A user holds several non-superadmin roles through
// several rows; the superadmin exclusivity rule is enforced by the workflow
// that writes these rows, not here.
const StaffAssignment = model
  .define("staff_assignment", {
    id: model.id({ prefix: "sasg" }).primaryKey(),
    user_id: model.text(),
    role_key: model.text(),
    is_break_glass: model.boolean().default(false),
    // A user id, "system" or "cli".
    assigned_by: model.text().nullable(),
  })
  .indexes([
    { name: "IDX_staff_assignment_user_id", on: ["user_id"] },
    { name: "IDX_staff_assignment_role_key", on: ["role_key"] },
    {
      name: "IDX_staff_assignment_user_role_unique",
      on: ["user_id", "role_key"],
      unique: true,
    },
    // At most one break-glass assignment may exist. A string where clause
    // gets AND deleted_at IS NULL appended by the DML index builder.
    {
      name: "IDX_staff_assignment_break_glass_unique",
      on: ["is_break_glass"],
      unique: true,
      where: "is_break_glass = true",
    },
  ]);

export default StaffAssignment;
