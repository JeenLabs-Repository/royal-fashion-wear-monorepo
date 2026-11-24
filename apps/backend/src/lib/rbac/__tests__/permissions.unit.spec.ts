import {
  PSEUDO_PERMISSIONS,
  effectivePermissions,
  evaluateAccess,
  validateRoleCombination,
} from "../access";
import {
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_GRANTS,
  ROLE_KEYS,
  SUPERADMIN_ONLY_PERMISSIONS,
  type Permission,
  type RoleKey,
} from "../permissions";

const NON_SUPERADMIN_ROLES = ROLE_KEYS.filter(
  (key) => key !== "superadmin"
) as RoleKey[];

const unionOf = (
  roles: readonly RoleKey[],
  grants: Record<RoleKey, readonly Permission[]> = ROLE_GRANTS
) => new Set<Permission>(roles.flatMap((role) => grants[role]));

// The check the union test relies on, kept as a function so a test can feed it
// a deliberately broken grant table and prove it notices.
const leakedSuperadminPermissions = (
  grants: Record<RoleKey, readonly Permission[]>
) => {
  const union = unionOf(NON_SUPERADMIN_ROLES, grants);
  return SUPERADMIN_ONLY_PERMISSIONS.filter((permission) =>
    union.has(permission)
  );
};

describe("permission catalogue", () => {
  test("holds exactly 22 distinct strings", () => {
    expect(PERMISSIONS).toHaveLength(22);
    expect(new Set(PERMISSIONS).size).toBe(22);
  });

  test.each([...PERMISSIONS])("%s has the resource:operation shape", (permission) => {
    expect(permission).toMatch(/^[a-z-]+:[a-z-]+$/);
  });
});

describe("roles", () => {
  test("are exactly the five documented keys", () => {
    expect([...ROLE_KEYS].sort()).toEqual(
      [
        "catalog_approver",
        "finance_readonly",
        "order_router",
        "superadmin",
        "support",
      ].sort()
    );
    expect(ROLE_DEFINITIONS.map((definition) => definition.key)).toEqual([
      ...ROLE_KEYS,
    ]);
  });

  test.each([...ROLE_KEYS])("%s grants only catalogue strings", (role) => {
    for (const permission of ROLE_GRANTS[role]) {
      expect(PERMISSIONS).toContain(permission);
    }
  });

  test("superadmin holds every catalogue string", () => {
    expect([...ROLE_GRANTS.superadmin].sort()).toEqual([...PERMISSIONS].sort());
  });

  test("each definition carries the same grants as the grant table", () => {
    for (const definition of ROLE_DEFINITIONS) {
      expect([...definition.permissions]).toEqual([
        ...ROLE_GRANTS[definition.key],
      ]);
      expect(definition.label.length).toBeGreaterThan(0);
    }
  });
});

describe("no single admin holds every permission", () => {
  test("the union of the four non-superadmin roles lacks every superadmin-only string", () => {
    const union = unionOf(NON_SUPERADMIN_ROLES);
    for (const permission of [
      "staff:manage",
      "integrations:manage",
      "vendors:manage",
      "audit:read",
      "orders:write",
    ] as Permission[]) {
      expect(union.has(permission)).toBe(false);
    }
    expect(leakedSuperadminPermissions(ROLE_GRANTS)).toEqual([]);
  });

  test("SUPERADMIN_ONLY_PERMISSIONS lists exactly those five strings", () => {
    expect([...SUPERADMIN_ONLY_PERMISSIONS].sort()).toEqual(
      [
        "audit:read",
        "integrations:manage",
        "orders:write",
        "staff:manage",
        "vendors:manage",
      ].sort()
    );
  });

  test.each(NON_SUPERADMIN_ROLES)("%s lacks at least one catalogue string", (role) => {
    const held = new Set<Permission>(ROLE_GRANTS[role]);
    expect(PERMISSIONS.some((permission) => !held.has(permission))).toBe(true);
  });

  test("the leak check notices a broken grant table (guard mutation)", () => {
    const broken = {
      ...ROLE_GRANTS,
      support: [...ROLE_GRANTS.support, "staff:manage"],
    } as Record<RoleKey, readonly Permission[]>;
    expect(leakedSuperadminPermissions(broken)).toContain("staff:manage");
  });
});

describe("role separation", () => {
  test("finance_readonly grants nothing outside the read-only set", () => {
    const allowed = new Set([
      "finance:read",
      "documents:read",
      "documents:export",
      "vendors:read",
      "catalog:read",
      "orders:read",
      "customers:read",
      "routing:read",
    ]);
    for (const permission of ROLE_GRANTS.finance_readonly) {
      expect(allowed.has(permission)).toBe(true);
    }
  });

  test("catalog_approver holds no routing, returns or finance permission", () => {
    for (const permission of ROLE_GRANTS.catalog_approver) {
      expect(permission).not.toMatch(/^(routing|returns|finance):/);
    }
  });

  test("order_router can route and book but support cannot", () => {
    expect(ROLE_GRANTS.order_router).toContain("routing:read");
    expect(ROLE_GRANTS.support).toContain("routing:read");
    for (const permission of [
      "routing:assign",
      "routing:book",
      "routing:deliver",
      "purchase-invoices:write",
    ] as Permission[]) {
      expect(ROLE_GRANTS.order_router).toContain(permission);
      expect(ROLE_GRANTS.support).not.toContain(permission);
    }
  });

  test("support decides returns and refunds but cannot read the catalogue", () => {
    expect(ROLE_GRANTS.support).toContain("returns:decide");
    expect(ROLE_GRANTS.support).toContain("finance:refund");
    expect(ROLE_GRANTS.support).not.toContain("catalog:read");
  });
});

describe("evaluateAccess", () => {
  const none = { roleKeys: [] as string[], permissions: [] as string[] };

  test("a normal permission needs the string in the set", () => {
    const ctx = {
      roleKeys: ["support"],
      permissions: effectivePermissions(["support"]),
    };
    expect(evaluateAccess(ctx, "returns:decide", { authenticated: true })).toBe(true);
    expect(evaluateAccess(ctx, "routing:assign", { authenticated: true })).toBe(false);
  });

  test("superadmin as a requirement is true only for the superadmin role", () => {
    const admin = {
      roleKeys: ["superadmin"],
      permissions: effectivePermissions(["superadmin"]),
    };
    const router = {
      roleKeys: ["order_router"],
      permissions: effectivePermissions(["order_router"]),
    };
    expect(evaluateAccess(admin, "superadmin", { authenticated: true })).toBe(true);
    expect(evaluateAccess(router, "superadmin", { authenticated: true })).toBe(false);
    expect(evaluateAccess(none, "superadmin", { authenticated: true })).toBe(false);
  });

  test("self is true for any authenticated caller, even with no roles", () => {
    expect(evaluateAccess(none, "self", { authenticated: true })).toBe(true);
    expect(evaluateAccess(none, "self", { authenticated: false })).toBe(false);
  });

  test("core-handled is true", () => {
    expect(evaluateAccess(none, "core-handled", { authenticated: true })).toBe(true);
  });

  test("a caller with no roles holds no catalogue permission", () => {
    for (const permission of PERMISSIONS) {
      expect(evaluateAccess(none, permission, { authenticated: true })).toBe(false);
    }
  });

  test("the pseudo permissions are exactly superadmin, self and core-handled", () => {
    expect([...PSEUDO_PERMISSIONS]).toEqual(["superadmin", "self", "core-handled"]);
  });

  test("effectivePermissions is the union and ignores unknown role keys", () => {
    const two = effectivePermissions(["catalog_approver", "support", "nonsense"]);
    expect(two).toContain("catalog:review");
    expect(two).toContain("returns:decide");
    expect(two).not.toContain("staff:manage");
  });
});

describe("validateRoleCombination", () => {
  test("superadmin with another role is exclusive", () => {
    expect(validateRoleCombination(["superadmin", "support"])).toBe("superadmin_exclusive");
  });

  test("an unlisted key is unknown", () => {
    expect(validateRoleCombination(["support", "root"])).toBe("unknown_role");
  });

  test("any mix of the four other roles is allowed", () => {
    expect(validateRoleCombination(NON_SUPERADMIN_ROLES)).toBeNull();
    expect(validateRoleCombination(["support"])).toBeNull();
    expect(validateRoleCombination(["superadmin"])).toBeNull();
    expect(validateRoleCombination([])).toBeNull();
  });
});
