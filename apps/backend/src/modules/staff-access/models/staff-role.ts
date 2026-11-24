import { model } from "@medusajs/framework/utils";

// One row per role key. The code in lib/rbac/permissions.ts is the source of
// truth and the boot-time sync overwrites label, description and permissions.
const StaffRole = model.define("staff_role", {
  id: model.id({ prefix: "srole" }).primaryKey(),
  key: model.text().unique(),
  label: model.text(),
  description: model.text().nullable(),
  permissions: model.json(),
});

export default StaffRole;
