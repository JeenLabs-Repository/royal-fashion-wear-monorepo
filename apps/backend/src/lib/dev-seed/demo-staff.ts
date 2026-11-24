// Demo staff accounts for development and browser specs. This file has no
// framework imports and holds no secret, so a browser spec can import it.
// Credentials are generated per run and recorded only in the untracked
// credentials file at the repository root.

export type DemoRoleKey =
  | "superadmin"
  | "catalog_approver"
  | "order_router"
  | "support"
  | "finance_readonly";

export type DemoStaffEntry = {
  roleKey: DemoRoleKey;
  email: string;
  firstName: string;
  lastName: string;
};

export const DEMO_STAFF: readonly DemoStaffEntry[] = [
  {
    roleKey: "superadmin",
    email: "staff.superadmin@example.test",
    firstName: "Demo",
    lastName: "Superadmin",
  },
  {
    roleKey: "catalog_approver",
    email: "staff.catalog-approver@example.test",
    firstName: "Demo",
    lastName: "Catalog Approver",
  },
  {
    roleKey: "order_router",
    email: "staff.order-router@example.test",
    firstName: "Demo",
    lastName: "Order Router",
  },
  {
    roleKey: "support",
    email: "staff.support@example.test",
    firstName: "Demo",
    lastName: "Support",
  },
  {
    roleKey: "finance_readonly",
    email: "staff.finance-readonly@example.test",
    firstName: "Demo",
    lastName: "Finance Read-only",
  },
];

// The admin that the test data seed creates holds no staff role, so default deny
// would lock it out of every Admin screen. The staff demo seed gives it superadmin
// and never runs in production.
export const DEMO_TEST_DATA_ADMIN_EMAIL = "admin@example.test";

// A signed-in user with no assignment, for the no-access screens.
export const DEMO_NO_ROLE_USER = {
  email: "staff.no-role@example.test",
  firstName: "Demo",
  lastName: "No Role",
} as const;
