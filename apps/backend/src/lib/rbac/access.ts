import {
  ROLE_GRANTS,
  ROLE_KEYS,
  SUPERADMIN_ROLE_KEY,
  type Permission,
  type RoleKey,
} from "./permissions";

// Pure helpers with no Medusa imports, so modules, middleware and tests can all
// use them. A rule in the permission manifest names either a catalogue string
// or one of these three words.
export const PSEUDO_PERMISSIONS = ["superadmin", "self", "core-handled"] as const;

export type PseudoPermission = (typeof PSEUDO_PERMISSIONS)[number];
export type ManifestPermission = Permission | PseudoPermission;

export type AccessContext = {
  roleKeys: readonly string[];
  permissions: ReadonlySet<string> | readonly string[];
};

export type AccessFlags = { authenticated: boolean };

const isRoleKey = (key: string): key is RoleKey =>
  (ROLE_KEYS as readonly string[]).includes(key);

/** The union of the grants of every known role key; unknown keys add nothing. */
export function effectivePermissions(roleKeys: readonly string[]): Permission[] {
  const union = new Set<Permission>();
  for (const key of roleKeys) {
    if (isRoleKey(key)) {
      for (const permission of ROLE_GRANTS[key]) {
        union.add(permission);
      }
    }
  }
  return [...union].sort();
}

const holds = (
  permissions: AccessContext["permissions"],
  permission: string
): boolean =>
  permissions instanceof Set
    ? permissions.has(permission)
    : (permissions as readonly string[]).includes(permission);

/**
 * Every permission check goes through this function. `superadmin` needs the
 * superadmin role, `self` needs only an authenticated caller, `core-handled`
 * means the framework route checks its own rules, and any other string must be
 * in the caller's permission set.
 */
export function evaluateAccess(
  ctx: AccessContext,
  required: ManifestPermission,
  flags: AccessFlags
): boolean {
  switch (required) {
    case "superadmin":
      return ctx.roleKeys.includes(SUPERADMIN_ROLE_KEY);
    case "self":
      return flags.authenticated;
    case "core-handled":
      return true;
    default:
      return holds(ctx.permissions, required);
  }
}

export type RoleCombinationError = "superadmin_exclusive" | "unknown_role";

/** Superadmin cannot be combined with any other role; every other mix is allowed. */
export function validateRoleCombination(
  roleKeys: readonly string[]
): RoleCombinationError | null {
  const distinct = [...new Set(roleKeys)];
  if (distinct.some((key) => !isRoleKey(key))) {
    return "unknown_role";
  }
  if (distinct.includes(SUPERADMIN_ROLE_KEY) && distinct.length > 1) {
    return "superadmin_exclusive";
  }
  return null;
}
