import type { MedusaContainer } from "@medusajs/framework/types";
import { createStaffUser, staffHeaders, type ApiClient } from "./staff-users";

export type StaffRoleKey =
  | "superadmin"
  | "catalog_approver"
  | "order_router"
  | "support"
  | "finance_readonly";

/**
 * Headers of a freshly created staff user that holds one role and has two-step
 * sign-in enrolled. This is the only wrapper around the staff helper, so a
 * changed helper signature changes here and nowhere else.
 */
export async function adminHeadersFor(
  api: ApiClient,
  container: MedusaContainer,
  role: StaffRoleKey
): Promise<Record<string, string>> {
  const user = await createStaffUser(container, { roleKeys: [role] });
  return staffHeaders(api, user);
}
