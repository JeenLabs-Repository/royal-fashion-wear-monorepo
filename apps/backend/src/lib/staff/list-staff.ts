import type { IUserModuleService, MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access";

export type MfaState = "enrolled" | "not_enrolled" | "unknown";

export type StaffRow = {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  roles: string[];
  is_break_glass: boolean;
  mfa_state: MfaState;
};

type StaffAccessApi = {
  listStaffAssignments(
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<Array<{ user_id: string; role_key: string; is_break_glass: boolean }>>;
};

type AuthMfaApi = {
  listAuthIdentities(
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<Array<{ id: string; app_metadata?: Record<string, unknown> | null }>>;
  // Spike S3: the Auth module method is listAuthMfa({ auth_identity_id, status: "enabled" }).
  listAuthMfa?: (
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<Array<{ auth_identity_id?: string; status?: string }>>;
};

/**
 * Two-step sign-in state per user. Any failure or missing method answers
 * "unknown" rather than guessing, and never fails the list.
 */
async function readMfaStates(
  container: MedusaContainer,
  users: Array<{ id: string; email: string }>
): Promise<Map<string, MfaState>> {
  const states = new Map<string, MfaState>(users.map((user) => [user.id, "unknown"]));
  try {
    const auth = container.resolve(Modules.AUTH) as unknown as AuthMfaApi;
    if (typeof auth.listAuthMfa !== "function") {
      return states;
    }
    const identities = await auth.listAuthIdentities(
      {
        provider_identities: {
          provider: "emailpass",
          entity_id: users.map((user) => user.email),
        },
      },
      { take: null }
    );
    const identityByUser = new Map<string, string>();
    for (const identity of identities) {
      const userId = identity.app_metadata?.user_id;
      if (typeof userId === "string") {
        identityByUser.set(userId, identity.id);
      }
    }
    const identityIds = [...identityByUser.values()];
    if (identityIds.length === 0) {
      for (const user of users) {
        if (identityByUser.has(user.id)) {
          states.set(user.id, "not_enrolled");
        }
      }
      return states;
    }
    const factors = await auth.listAuthMfa(
      { auth_identity_id: identityIds, status: "enabled" },
      { take: null, select: ["id", "auth_identity_id", "status"] }
    );
    const enrolledIdentities = new Set(
      factors.map((factor) => factor.auth_identity_id).filter((id): id is string => !!id)
    );
    for (const user of users) {
      const identityId = identityByUser.get(user.id);
      if (identityId) {
        states.set(user.id, enrolledIdentities.has(identityId) ? "enrolled" : "not_enrolled");
      }
    }
  } catch {
    // Left as unknown for every user the lookup did not reach.
  }
  return states;
}

/**
 * Users ordered by email with their roles, break-glass flag and two-step state.
 * Rows are built field by field: nothing else from the user record is returned.
 */
export async function listStaff(
  container: MedusaContainer,
  { limit, offset }: { limit: number; offset: number }
): Promise<{ staff: StaffRow[]; count: number; limit: number; offset: number }> {
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const staff = container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);

  const [rows, count] = await users.listAndCountUsers(
    {},
    {
      select: ["id", "email", "first_name", "last_name"],
      order: { email: "ASC" },
      take: limit,
      skip: offset,
    }
  );

  const ids = rows.map((row) => row.id);
  const assignments = ids.length
    ? await staff.listStaffAssignments({ user_id: ids }, { take: null })
    : [];
  const mfa = await readMfaStates(
    container,
    rows.map((row) => ({ id: row.id, email: row.email }))
  );

  return {
    staff: rows.map((row) => {
      const own = assignments.filter((assignment) => assignment.user_id === row.id);
      return {
        user_id: row.id,
        email: row.email,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        roles: own.map((assignment) => assignment.role_key).sort(),
        is_break_glass: own.some((assignment) => assignment.is_break_glass),
        mfa_state: mfa.get(row.id) ?? "unknown",
      };
    }),
    count,
    limit,
    offset,
  };
}
