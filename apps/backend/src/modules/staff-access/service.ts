import { MedusaService } from "@medusajs/framework/utils";
import {
  SUPERADMIN_ROLE_KEY,
  type RoleDefinition,
} from "../../lib/rbac/permissions";
import BreakGlassReview from "./models/break-glass-review";
import StaffAssignment from "./models/staff-assignment";
import StaffRole from "./models/staff-role";

export type SyncRolesResult = {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Role keys present in the database but not in code; they are kept. */
  stale: string[];
};

export type EffectiveAccess = {
  assignments: {
    id: string;
    user_id: string;
    role_key: string;
    is_break_glass: boolean;
  }[];
  roleKeys: string[];
  permissions: string[];
  isBreakGlass: boolean;
};

// The permissions column is a json column typed as an object; the code stores a
// plain string array in it.
const asJson = (permissions: readonly string[]) =>
  [...permissions] as unknown as Record<string, unknown>;

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const sameSet = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

class StaffAccessModuleService extends MedusaService({
  StaffRole,
  StaffAssignment,
  BreakGlassReview,
}) {
  /**
   * Idempotent: creates missing roles, rewrites label, description and
   * permissions of existing ones from the definition, and reports (never
   * deletes) roles that exist only in the database. The caller logs the stale
   * keys.
   */
  async syncRoles(
    definitions: readonly RoleDefinition[]
  ): Promise<SyncRolesResult> {
    const existing = await this.listStaffRoles({}, { take: null });
    const byKey = new Map(existing.map((row) => [row.key, row]));
    const result: SyncRolesResult = {
      created: [],
      updated: [],
      unchanged: [],
      stale: [],
    };

    const toCreate: {
      key: string;
      label: string;
      description: string;
      permissions: Record<string, unknown>;
    }[] = [];
    const toUpdate: {
      id: string;
      label: string;
      description: string;
      permissions: Record<string, unknown>;
    }[] = [];

    for (const definition of definitions) {
      const row = byKey.get(definition.key);
      if (!row) {
        toCreate.push({
          key: definition.key,
          label: definition.label,
          description: definition.description,
          permissions: asJson(definition.permissions),
        });
        result.created.push(definition.key);
        continue;
      }
      const same =
        row.label === definition.label &&
        row.description === definition.description &&
        sameSet(asList(row.permissions), definition.permissions);
      if (same) {
        result.unchanged.push(definition.key);
      } else {
        toUpdate.push({
          id: row.id,
          label: definition.label,
          description: definition.description,
          permissions: asJson(definition.permissions),
        });
        result.updated.push(definition.key);
      }
    }

    if (toCreate.length) {
      await this.createStaffRoles(toCreate);
    }
    if (toUpdate.length) {
      await this.updateStaffRoles(toUpdate);
    }

    const codeKeys = new Set<string>(
      definitions.map((definition) => definition.key)
    );
    result.stale = existing
      .map((row) => row.key)
      .filter((key) => !codeKeys.has(key));
    return result;
  }

  /** Two indexed reads: the user's assignments, then the role rows they name. */
  async resolveEffectiveAccess(userId: string): Promise<EffectiveAccess> {
    const rows = await this.listStaffAssignments(
      { user_id: userId },
      { take: null }
    );
    const assignments = rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      role_key: row.role_key,
      is_break_glass: row.is_break_glass,
    }));
    const roleKeys = [...new Set(assignments.map((row) => row.role_key))];
    const roles = roleKeys.length
      ? await this.listStaffRoles({ key: roleKeys }, { take: null })
      : [];
    const permissions = [
      ...new Set(roles.flatMap((role) => asList(role.permissions))),
    ].sort();
    return {
      assignments,
      roleKeys,
      permissions,
      isBreakGlass: assignments.some((row) => row.is_break_glass),
    };
  }

  /**
   * Distinct users holding superadmin without the break-glass flag. The caller
   * passes only ids it has confirmed still exist in the User module.
   */
  async countNonBreakGlassSuperadmins(
    existingUserIds: readonly string[]
  ): Promise<number> {
    if (!existingUserIds.length) {
      return 0;
    }
    const rows = await this.listStaffAssignments(
      {
        role_key: SUPERADMIN_ROLE_KEY,
        is_break_glass: false,
        user_id: [...existingUserIds],
      },
      { select: ["user_id"], take: null }
    );
    return new Set(rows.map((row) => row.user_id)).size;
  }
}

export default StaffAccessModuleService;
