// The permission manifest: which permission each admin route needs.
//
// How to add a rule (every change that adds an admin route does this in the
// same change as the route):
// 1. Add the permission string and its role grants to permissions.ts.
// 2. Add the rule here. A pattern is written in lower case; a trailing star
//    covers a whole family; the most specific rule wins, not the first one.
// 3. Run `pnpm --dir apps/backend run check:admin-routes`. It fails and lists
//    every route no rule covers.
//
// Rules for rules
// - A route with no rule is superadmin only at runtime (default deny).
// - A mutating method never uses a `:read` permission, and `documents:export`
//   never guards a mutation. A unit test enforces both.
// - `self` means any signed-in staff-type caller, even with no role, and is
//   allowed only on the GET patterns in SELF_GET_PATTERNS.
// - `core-handled` marks the one route that authenticates itself.
// - A rule may name guards from GUARD_NAMES; the middleware chain runs them
//   after the permission check passed.

import { PERM } from "./permissions";
import type { ManifestPermission } from "./access";
import type { ManifestRule } from "./match-manifest";

/** The only guard names a rule may use. Each needs an entry in the guard registry. */
export const GUARD_NAMES = ["protect-staff-target"] as const;
export type GuardName = (typeof GUARD_NAMES)[number];

/** GET patterns that may use the `self` pseudo permission. */
export const SELF_GET_PATTERNS: readonly string[] = [
  "/admin/users/me",
  "/admin/staff/me",
  // Sidebar Header calls useStore() and throws on 403; without this every
  // non-superadmin page becomes Medusa's Access Denied before a custom
  // no-access panel can render. Store name and currency qualify as shell data
  // (same policy as the later dashboard shell probe). Mutations stay denied.
  "/admin/stores*",
  // Dashboard shell GETs the Security screen needs while MFA enrolment is
  // still open (spike S3). Content is layout config, module names, empty
  // notification counts and cloud announcements — no business data.
  "/admin/layouts*",
  "/admin/modules",
  "/admin/search-indexes",
  "/admin/notifications*",
  "/admin/cloud/announcements*",
  // Measured 2026-11-25 by the dashboard shell probe: flag names only.
  "/admin/feature-flags",
];

const MUTATING_METHODS = ["POST", "DELETE", "PUT", "PATCH"] as const;
const ALL_METHODS = ["GET", ...MUTATING_METHODS] as const;

// Policy for mapping an admin route family (applied here and by every later
// change; a method gets its own rule only when it needs a different permission):
// - A read maps to the `:read` permission of the same area when the area exists
//   in the catalogue.
// - A mutation maps to the area's write or decide permission when the catalogue
//   has one, otherwise to superadmin.
// - A family with no catalogue area maps to superadmin for every method.
// - Plugin and enterprise-module families found in the installed packages map
//   to superadmin.
// - Never map a mutating method to a read permission.
// - Never use `self` for a family; shell reads are added to SELF_GET_PATTERNS
//   from a measured probe.
type FamilyGrants = { read: ManifestPermission; write: ManifestPermission };

function family(prefixes: readonly string[], grants: FamilyGrants, note?: string): ManifestRule[] {
  return prefixes.flatMap((prefix) => [
    { method: "GET", pattern: `${prefix}*`, permission: grants.read, note } as ManifestRule,
    ...MUTATING_METHODS.map(
      (method) =>
        ({ method, pattern: `${prefix}*`, permission: grants.write, note }) as ManifestRule
    ),
  ]);
}

// One explicit rule per method, so a reviewer sees every method covered.
function everyMethod(
  pattern: string,
  permission: ManifestPermission,
  extra: Pick<ManifestRule, "guards" | "note"> = {}
): ManifestRule[] {
  return ALL_METHODS.map((method) => ({ method, pattern, permission, ...extra }) as ManifestRule);
}

function only(
  methods: readonly ManifestRule["method"][],
  pattern: string,
  permission: ManifestPermission,
  extra: Pick<ManifestRule, "guards" | "note"> = {}
): ManifestRule[] {
  return methods.map((method) => ({ method, pattern, permission, ...extra }) as ManifestRule);
}

export const PERMISSION_MANIFEST: readonly ManifestRule[] = [
  // Self and core-handled
  { method: "GET", pattern: "/admin/users/me", permission: "self" },
  { method: "GET", pattern: "/admin/staff/me", permission: "self" },
  {
    method: "GET",
    pattern: "/admin/stores*",
    permission: "self",
    note: "Dashboard shell: sidebar store name. Mutations stay superadmin below.",
  },
  {
    method: "GET",
    pattern: "/admin/layouts*",
    permission: "self",
    note: "Dashboard shell: layout configuration for Profile and Security.",
  },
  {
    method: "GET",
    pattern: "/admin/modules",
    permission: "self",
    note: "Dashboard shell: installed module names only.",
  },
  {
    method: "GET",
    pattern: "/admin/search-indexes",
    permission: "self",
    note: "Dashboard shell: search index metadata only.",
  },
  {
    method: "GET",
    pattern: "/admin/notifications*",
    permission: "self",
    note: "Dashboard shell: notification bell; no message bodies required at load.",
  },
  {
    method: "GET",
    pattern: "/admin/cloud/announcements*",
    permission: "self",
    note: "Dashboard shell: Medusa cloud announcements banner.",
  },
  {
    method: "GET",
    pattern: "/admin/feature-flags",
    permission: "self",
    note: "Dashboard shell read, measured on 2026-11-25; flag names only.",
  },
  {
    method: "POST",
    pattern: "/admin/invites/accept",
    permission: "core-handled",
    note: "Core authenticates this route itself; the chain only audits it.",
  },

  // Governance
  { method: "GET", pattern: "/admin/audit-log*", permission: PERM.auditRead },
  ...everyMethod("/admin/staff*", PERM.staffManage),
  ...only(["POST"], "/admin/staff/:user_id/roles", PERM.staffManage, {
    guards: ["protect-staff-target"],
  }),
  ...only(["DELETE"], "/admin/staff/:user_id/roles/:role", PERM.staffManage, {
    guards: ["protect-staff-target"],
  }),
  ...everyMethod("/admin/integrations*", PERM.integrationsManage, {
    note: "Settings > Integrations and its API: superadmin only.",
  }),
  ...everyMethod("/admin/users*", PERM.staffManage),
  ...only(["POST", "DELETE"], "/admin/users/:id", PERM.staffManage, {
    guards: ["protect-staff-target"],
  }),
  ...everyMethod("/admin/invites*", PERM.staffManage),
  ...everyMethod("/admin/api-keys*", "superadmin"),

  // Planned family, pre-mapped so the role matrix can be proven before the
  // routing routes exist. The routing work adds longer rules for booking and
  // delivery, which win by specificity.
  { method: "GET", pattern: "/admin/routing*", permission: PERM.routingRead },
  ...only(["POST", "DELETE", "PUT", "PATCH"], "/admin/routing*", PERM.routingAssign, {
    note: "Booking and delivery rules are added with their routes.",
  }),

  // Vendor management. Reads for every staff role that sees vendors and writes
  // for superadmin only. The invite, the lifecycle actions and the location
  // routes are all POST, and the other write methods are mapped too so no
  // later route can slip through as a read.
  { method: "GET", pattern: "/admin/vendors*", permission: PERM.vendorsRead },
  ...only(["POST", "DELETE", "PUT", "PATCH"], "/admin/vendors*", PERM.vendorsManage),

  // Core families, read then write
  ...family(
    [
      "/admin/products",
      "/admin/product-variants",
      "/admin/product-options",
      "/admin/product-categories",
      "/admin/product-tags",
      "/admin/product-types",
      "/admin/collections",
      "/admin/uploads",
    ],
    { read: PERM.catalogRead, write: PERM.catalogEdit }
  ),
  ...family(
    ["/admin/price-lists", "/admin/price-preferences", "/admin/promotions", "/admin/campaigns"],
    { read: PERM.catalogRead, write: "superadmin" }
  ),
  ...family(
    [
      "/admin/orders",
      "/admin/draft-orders",
      "/admin/order-edits",
      "/admin/order-changes",
      "/admin/claims",
      "/admin/exchanges",
    ],
    { read: PERM.ordersRead, write: PERM.ordersWrite }
  ),
  ...family(
    [
      "/admin/fulfillments",
      "/admin/fulfillment-sets",
      "/admin/fulfillment-providers",
      "/admin/shipping-options",
      "/admin/shipping-option-types",
      "/admin/shipping-profiles",
    ],
    { read: PERM.ordersRead, write: "superadmin" }
  ),
  ...family(["/admin/returns"], { read: PERM.returnsRead, write: PERM.returnsDecide }),
  ...family(["/admin/return-reasons", "/admin/refund-reasons"], {
    read: PERM.returnsRead,
    write: "superadmin",
  }),
  { method: "POST", pattern: "/admin/payments/:id/refund", permission: PERM.financeRefund },
  ...family(["/admin/payments", "/admin/payment-collections"], {
    read: PERM.financeRead,
    write: PERM.ordersWrite,
  }),
  ...family(["/admin/customers", "/admin/customer-groups"], {
    read: PERM.customersRead,
    write: "superadmin",
  }),
  ...family(["/admin/inventory-items", "/admin/reservations", "/admin/stock-locations"], {
    read: PERM.catalogRead,
    write: "superadmin",
  }),
  ...family(
    [
      "/admin/sales-channels",
      "/admin/regions",
      "/admin/tax-regions",
      "/admin/tax-rates",
      "/admin/tax-providers",
      "/admin/currencies",
      "/admin/translations",
      "/admin/locales",
      "/admin/plugins",
      "/admin/workflows-executions",
    ],
    { read: "superadmin", write: "superadmin" }
  ),
  // Store and shell mutations stay owner-only; matching GETs are self above.
  ...only(["POST", "DELETE", "PUT", "PATCH"], "/admin/stores*", "superadmin"),
  ...only(["POST", "DELETE", "PUT", "PATCH"], "/admin/layouts*", "superadmin"),
  ...only(["POST", "DELETE", "PUT", "PATCH"], "/admin/notifications*", "superadmin"),
  // Dashboard shell, search, views and dormant enterprise/plugin families.
  // Shell GETs listed in SELF_GET_PATTERNS stay above; everything else here
  // stays superadmin so a mutating method never inherits a read grant.
  ...family(
    [
      "/admin/modules",
      "/admin/feature-flags",
      "/admin/search",
      "/admin/search-indexes",
      "/admin/index",
      "/admin/views",
      "/admin/property-labels",
      "/admin/audit-logs",
      "/admin/cloud",
    ],
    { read: "superadmin", write: "superadmin" }
  ),
];
