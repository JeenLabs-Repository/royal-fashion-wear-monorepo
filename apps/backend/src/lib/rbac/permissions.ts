// The only place a permission string is declared. Later work adds its strings
// here in the same change as the routes that use them, and adds the grants to
// the roles below. Roles are seeded from this file on every boot, so the code
// always wins over the database rows: a hand edit of a role row does not
// survive the next start.
//
// The shape is resource:operation. It stays compatible with a later switch to
// Medusa's licensed RBAC, which uses the same two-part names.

export const PERMISSIONS = [
  "staff:manage",
  "integrations:manage",
  "audit:read",
  "vendors:read",
  "vendors:manage",
  "catalog:read",
  "catalog:review",
  "catalog:edit",
  "orders:read",
  "customers:read",
  "orders:write",
  "routing:read",
  "routing:assign",
  "routing:book",
  "routing:deliver",
  "purchase-invoices:write",
  "returns:read",
  "returns:decide",
  "finance:read",
  "documents:read",
  "documents:export",
  "finance:refund",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = [
  "superadmin",
  "catalog_approver",
  "order_router",
  "support",
  "finance_readonly",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const SUPERADMIN_ROLE_KEY: RoleKey = "superadmin";

/** Held by the superadmin role alone. No mix of the other roles may include any of these. */
export const SUPERADMIN_ONLY_PERMISSIONS = [
  "staff:manage",
  "integrations:manage",
  "audit:read",
  "vendors:manage",
  "orders:write",
] as const satisfies readonly Permission[];

export type RoleDefinition = {
  key: RoleKey;
  label: string;
  description: string;
  permissions: readonly Permission[];
};

export const ROLE_GRANTS: Record<RoleKey, readonly Permission[]> = {
  superadmin: [...PERMISSIONS],
  catalog_approver: [
    "vendors:read",
    "catalog:read",
    "catalog:review",
    "catalog:edit",
  ],
  order_router: [
    "vendors:read",
    "catalog:read",
    "orders:read",
    "customers:read",
    "routing:read",
    "routing:assign",
    "routing:book",
    "routing:deliver",
    "purchase-invoices:write",
    "returns:read",
  ],
  support: [
    "vendors:read",
    "orders:read",
    "customers:read",
    "routing:read",
    "returns:read",
    "returns:decide",
    "finance:refund",
  ],
  finance_readonly: [
    "vendors:read",
    "catalog:read",
    "orders:read",
    "customers:read",
    "routing:read",
    "finance:read",
    "documents:read",
    "documents:export",
  ],
};

const ROLE_TEXT: Record<RoleKey, { label: string; description: string }> = {
  superadmin: {
    label: "Superadmin",
    description:
      "Manages staff, integrations, vendors and the audit log. Cannot be combined with another role.",
  },
  catalog_approver: {
    label: "Catalog approver",
    description: "Reviews and edits product submissions from vendors.",
  },
  order_router: {
    label: "Order router",
    description:
      "Assigns each order to a vendor location, books shipments and records deliveries.",
  },
  support: {
    label: "Support",
    description: "Answers customers, decides returns and issues refunds.",
  },
  finance_readonly: {
    label: "Finance (read only)",
    description: "Reads finance records and exports documents. Changes nothing.",
  },
};

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = ROLE_KEYS.map(
  (key) => ({
    key,
    label: ROLE_TEXT[key].label,
    description: ROLE_TEXT[key].description,
    permissions: ROLE_GRANTS[key],
  })
);

/**
 * Named handles for the catalogue strings. Rule tables and routes refer to a
 * permission by name so the string itself is written only in this file. The
 * `satisfies` check fails the build if a value drifts out of the catalogue.
 */
export const PERM = {
  staffManage: "staff:manage",
  integrationsManage: "integrations:manage",
  auditRead: "audit:read",
  vendorsRead: "vendors:read",
  vendorsManage: "vendors:manage",
  catalogRead: "catalog:read",
  catalogReview: "catalog:review",
  catalogEdit: "catalog:edit",
  ordersRead: "orders:read",
  customersRead: "customers:read",
  ordersWrite: "orders:write",
  routingRead: "routing:read",
  routingAssign: "routing:assign",
  routingBook: "routing:book",
  routingDeliver: "routing:deliver",
  purchaseInvoicesWrite: "purchase-invoices:write",
  returnsRead: "returns:read",
  returnsDecide: "returns:decide",
  financeRead: "finance:read",
  documentsRead: "documents:read",
  documentsExport: "documents:export",
  financeRefund: "finance:refund",
} as const satisfies Record<string, Permission>;

