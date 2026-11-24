import { randomBytes } from "node:crypto";
import type { MedusaContainer } from "@medusajs/framework";
import type {
  IAuthModuleService,
  IUserModuleService,
} from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";
import { createUserAccountWorkflow } from "@medusajs/medusa/core-flows";
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access";
import type StaffAccessModuleService from "../../modules/staff-access/service";
import { assignStaffRoleWorkflow } from "../../workflows/assign-staff-role";
import { revokeStaffRoleWorkflow } from "../../workflows/revoke-staff-role";
import { recordAudit } from "../audit";
import { DEMO_NO_ROLE_USER, DEMO_STAFF, DEMO_TEST_DATA_ADMIN_EMAIL } from "../dev-seed/demo-staff";
import { ROLE_DEFINITIONS, type RoleKey } from "../rbac/permissions";
import { listStaff } from "../staff/list-staff";
import { generatePassword } from "./password";

const EMAILPASS = "emailpass";

export const PASSWORD_LABEL = "One-time password (shown once, store it now):";
export const ENROL_REMINDER =
  "Before this account can reach any Admin screen it must set up TOTP under Profile > Security.";
export const BREAK_GLASS_REMINDER =
  "The first use of the break-glass account sends the break-glass alert and opens a review.";

// Spike S3: listAuthMfa and disableAuthMfa (disable is the removal path; there is
// no public delete-by-filter). Recovery codes have no public list/delete API.
type AuthMfaApi = IAuthModuleService & {
  listAuthMfa: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<Array<{ id: string; status?: string }>>;
  disableAuthMfa: (data: {
    id: string;
    method?: string;
    code?: string;
  }) => Promise<unknown>;
};

type CliActor = {
  id: string;
  type: "system";
  label: string;
  roles: string[];
};

type AuthIdentityRef = { id: string; linkedUserId: string | null };

export type GrantSuperadminResult = {
  userId: string;
  created: boolean;
  password: string | null;
  alreadySuperadmin: boolean;
};

export type BreakGlassResult = {
  userId: string;
  email: string;
  password: string;
};

export type StaffRow = {
  user_id: string;
  email: string;
  roles: string[];
  is_break_glass: boolean;
  mfa_state: string;
};

export type DemoSeedRow = {
  role: string;
  email: string;
  password: string | null;
  mfa: "not_enrolled" | "enrolled" | "unknown";
  created: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (raw: string | undefined): string => {
  const email = (raw ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A valid email address is required."
    );
  }
  return email;
};

// Prefer ExecArgs.args when Medusa filled them. When the script is started as
// `pnpm run <script> -- <words>`, pnpm inserts a bare `--` and Medusa's
// `exec [file] [args..]` then receives an empty args array; the words stay on
// process.argv after that `--`, so fall back to reading them from there.
export const positionalArgs = (args: string[] | undefined): string[] => {
  const fromArgs = (args ?? []).filter((arg) => arg !== "--" && arg.length > 0);
  if (fromArgs.length > 0) {
    return fromArgs;
  }
  const argv = process.argv;
  const separator = argv.lastIndexOf("--");
  if (separator === -1) {
    return [];
  }
  return argv.slice(separator + 1).filter((arg) => arg !== "--" && arg.length > 0);
};

const osUserName = (): string => {
  const raw = process.env.USER ?? process.env.USERNAME ?? process.env.LOGNAME ?? "";
  const clean = raw.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
  return clean || "unknown";
};

const cliActor = (): CliActor => ({
  id: "cli",
  type: "system",
  label: `cli:${osUserName()}`,
  roles: [],
});

const staffService = (container: MedusaContainer) =>
  container.resolve<StaffAccessModuleService>(STAFF_ACCESS_MODULE);

// The loader may never have run on a database restored for recovery, so sync the roles first.
const prepare = async (container: MedusaContainer) => {
  const staff = staffService(container);
  await staff.syncRoles(ROLE_DEFINITIONS);
  return staff;
};

const findUserByEmail = async (container: MedusaContainer, email: string) => {
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const [user] = await users.listUsers({ email });
  return user ?? null;
};

const findEmailpassIdentity = async (
  container: MedusaContainer,
  email: string
): Promise<AuthIdentityRef | null> => {
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  // Same filter shape as the staff list helper and the test adopt helper.
  const [identity] = await auth.listAuthIdentities(
    { provider_identities: { provider: EMAILPASS, entity_id: [email] } } as never,
    { take: 1 }
  );
  if (!identity) {
    return null;
  }
  const linked = (identity.app_metadata as Record<string, unknown> | null | undefined)
    ?.user_id;
  return { id: identity.id, linkedUserId: typeof linked === "string" ? linked : null };
};

const registerIdentity = async (
  container: MedusaContainer,
  email: string,
  password: string
): Promise<string> => {
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  // Spike S5: auth.register("emailpass", { body: { email, password } })
  const { success, authIdentity, error } = await auth.register(EMAILPASS, {
    body: { email, password },
  } as Parameters<IAuthModuleService["register"]>[1]);
  if (!success || !authIdentity) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Could not register an identity for ${email}: ${error ?? "unknown error"}`
    );
  }
  return authIdentity.id;
};

const createUserWithIdentity = async (
  container: MedusaContainer,
  input: { email: string; password: string; firstName: string; lastName: string }
): Promise<string> => {
  const authIdentityId = await registerIdentity(container, input.email, input.password);
  const { result } = await createUserAccountWorkflow(container).run({
    input: {
      authIdentityId,
      userData: {
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
      },
    },
  });
  return (result as { id: string }).id;
};

const linkIdentity = async (
  container: MedusaContainer,
  identityId: string,
  userId: string
): Promise<void> => {
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  await auth.updateAuthIdentities({
    id: identityId,
    app_metadata: { user_id: userId },
  });
};

const setPassword = async (
  container: MedusaContainer,
  email: string,
  password: string
): Promise<void> => {
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  // Spike S5: updateProvider("emailpass", { email, password, entity_id }).
  // For emailpass, entity_id is the email of the provider identity.
  const result = await auth.updateProvider(EMAILPASS, {
    email,
    password,
    entity_id: email,
  });
  if (!result.success) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Could not set the password for ${email}: ${result.error ?? "unknown error"}`
    );
  }
};

type KnexLike = {
  raw: (sql: string, bindings?: unknown[]) => Promise<unknown>;
};

const pgConnection = (container: MedusaContainer): KnexLike | null => {
  try {
    return container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as KnexLike;
  } catch {
    return null;
  }
};

// Challenge policy blocks disableAuthMfa without a TOTP code. Recovery runs from
// the server shell (already full trust), so force-disable enabled factors and
// soft-delete recovery codes through the database when the public API refuses.
const forceClearMfaRows = async (
  container: MedusaContainer,
  identityId: string,
  factorIds: string[]
): Promise<void> => {
  const pg = pgConnection(container);
  if (!pg) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Cannot force-clear MFA factors without a database connection."
    );
  }
  if (factorIds.length > 0) {
    await pg.raw(
      `UPDATE auth_mfa_factor SET status = 'disabled', updated_at = NOW() WHERE id = ANY(?) AND deleted_at IS NULL`,
      [factorIds]
    );
  }
  await pg.raw(
    `UPDATE auth_mfa_recovery_code SET deleted_at = NOW() WHERE auth_identity_id = ? AND deleted_at IS NULL`,
    [identityId]
  );
};

const listFactorIds = async (
  auth: AuthMfaApi,
  identityId: string,
  status?: string
): Promise<string[]> => {
  const filters: Record<string, unknown> = { auth_identity_id: identityId };
  if (status) {
    filters.status = status;
  }
  const factors = await auth.listAuthMfa(filters);
  return factors.map((factor) => factor.id);
};

// Removes every MFA factor and recovery code of an identity, then proves none remain enabled.
const removeMfaFactors = async (
  container: MedusaContainer,
  identityId: string
): Promise<number> => {
  const auth = container.resolve(Modules.AUTH) as AuthMfaApi;
  if (typeof auth.listAuthMfa !== "function" || typeof auth.disableAuthMfa !== "function") {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The Auth module does not expose listAuthMfa/disableAuthMfa. Check the recorded MFA findings."
    );
  }

  const factors = await auth.listAuthMfa({ auth_identity_id: identityId });
  const openIds = factors
    .filter((factor) => factor.status !== "disabled")
    .map((factor) => factor.id);

  for (const id of openIds) {
    try {
      // Spike S3: disableAuthMfa({ id }) is the removal path.
      // Pending factors often "succeed" without leaving the row disabled, so
      // every open id is force-cleared below regardless of this call.
      await auth.disableAuthMfa({ id });
    } catch {
      // Challenge policy or a missing code; force-clear handles it.
    }
  }

  // Always force-clear open factors and recovery codes so a pending row cannot
  // block the next enrolment (create rejects when any non-disabled TOTP remains).
  await forceClearMfaRows(container, identityId, openIds);

  const left = await listFactorIds(auth, identityId, "enabled");
  if (left.length > 0) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "MFA factors remain after the reset."
    );
  }
  return factors.length;
};

const mfaStateOf = async (
  container: MedusaContainer,
  identityId: string
): Promise<DemoSeedRow["mfa"]> => {
  try {
    const auth = container.resolve(Modules.AUTH) as AuthMfaApi;
    if (typeof auth.listAuthMfa !== "function") {
      return "unknown";
    }
    return (await listFactorIds(auth, identityId, "enabled")).length > 0
      ? "enrolled"
      : "not_enrolled";
  } catch {
    return "unknown";
  }
};

export const grantSuperadmin = async (
  container: MedusaContainer,
  options: { email: string; resetPassword: boolean }
): Promise<GrantSuperadminResult> => {
  const email = normalizeEmail(options.email);
  const staff = await prepare(container);
  const actor = cliActor();
  const workflowActor = { id: actor.id, type: actor.type, label: actor.label };

  let user = await findUserByEmail(container, email);
  let created = false;
  let password: string | null = null;

  if (!user) {
    password = generatePassword(24);
    const userId = await createUserWithIdentity(container, {
      email,
      password,
      firstName: "Recovery",
      lastName: "Superadmin",
    });
    created = true;
    user = await findUserByEmail(container, email);
    if (!user || user.id !== userId) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The new user could not be read back."
      );
    }
  } else {
    const access = await staff.resolveEffectiveAccess(user.id);
    if (access.isBreakGlass) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This is the break-glass account. Use rotate-break-glass to change its password.",
        "break_glass_protected"
      );
    }
    const identity = await findEmailpassIdentity(container, email);
    if (!identity) {
      password = generatePassword(24);
      const identityId = await registerIdentity(container, email, password);
      await linkIdentity(container, identityId, user.id);
    } else {
      if (!identity.linkedUserId) {
        await linkIdentity(container, identity.id, user.id);
      }
      if (options.resetPassword) {
        password = generatePassword(24);
        await setPassword(container, email, password);
      }
    }
  }

  const access = await staff.resolveEffectiveAccess(user.id);
  const alreadySuperadmin = access.roleKeys.includes("superadmin");

  if (!alreadySuperadmin) {
    // Superadmin stands alone, so every other role goes first.
    for (const role of access.roleKeys) {
      await revokeStaffRoleWorkflow(container).run({
        input: { user_id: user.id, role, actor: workflowActor },
      });
    }
    await assignStaffRoleWorkflow(container).run({
      input: { user_id: user.id, role: "superadmin", actor: workflowActor },
    });
  }

  await recordAudit(container, {
    action: "staff.superadmin_granted",
    actor,
    target: { type: "user", id: user.id },
    meta: { created_user: created, reset_password: Boolean(options.resetPassword) },
  });

  return { userId: user.id, created, password, alreadySuperadmin };
};

export const createBreakGlass = async (
  container: MedusaContainer,
  options: { email: string }
): Promise<BreakGlassResult> => {
  const email = normalizeEmail(options.email);
  const staff = await prepare(container);

  const existing = await staff.listStaffAssignments({ is_break_glass: true });
  if (existing.length > 0) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "A break-glass account already exists. Use rotate-break-glass to change its password.",
      "break_glass_exists"
    );
  }
  if (await findUserByEmail(container, email)) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "That email already belongs to a user. Use a new address for the break-glass account.",
      "email_in_use"
    );
  }

  const password = generatePassword(24);
  const userId = await createUserWithIdentity(container, {
    email,
    password,
    firstName: "Break-glass",
    lastName: "Admin",
  });

  // The role workflows refuse break-glass targets by design, so write the row directly.
  await staff.createStaffAssignments({
    user_id: userId,
    role_key: "superadmin",
    is_break_glass: true,
    assigned_by: "cli",
  });

  await recordAudit(container, {
    action: "break_glass.created",
    actor: cliActor(),
    target: { type: "user", id: userId },
  });

  return { userId, email, password };
};

export const rotateBreakGlass = async (
  container: MedusaContainer
): Promise<BreakGlassResult> => {
  const staff = await prepare(container);
  const [assignment] = await staff.listStaffAssignments({ is_break_glass: true });
  if (!assignment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "There is no break-glass account. Run create-break-glass first.",
      "break_glass_missing"
    );
  }

  const users = container.resolve<IUserModuleService>(Modules.USER);
  const user = await users.retrieveUser(assignment.user_id);
  const email = (user.email ?? "").toLowerCase();
  const identity = await findEmailpassIdentity(container, email);
  if (!identity) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "The break-glass user has no sign-in identity.",
      "identity_missing"
    );
  }

  // Reset the factors first, so a failure here leaves the old password untouched.
  await removeMfaFactors(container, identity.id);
  const password = generatePassword(24);
  await setPassword(container, email, password);

  await recordAudit(container, {
    action: "break_glass.rotated",
    actor: cliActor(),
    target: { type: "user", id: user.id },
    meta: { mfa_reset: true },
  });

  return { userId: user.id, email, password };
};

export const listStaffRows = async (container: MedusaContainer): Promise<StaffRow[]> => {
  await prepare(container);
  const { staff: listed } = await listStaff(container, { limit: 200, offset: 0 });
  const mapped: StaffRow[] = listed.map((row) => ({
    user_id: row.user_id,
    email: row.email,
    roles: [...row.roles],
    is_break_glass: Boolean(row.is_break_glass),
    mfa_state: String(row.mfa_state),
  }));

  // A read of the roster from the server shell is traceable. The entry holds a count only.
  await recordAudit(container, {
    action: "staff.listed",
    actor: cliActor(),
    target: { type: "staff" },
    meta: { row_count: mapped.length },
  });

  return mapped;
};

const demoPassword = (): string => randomBytes(12).toString("base64url");

export const seedDemoStaff = async (
  container: MedusaContainer,
  options: { production: boolean; resetMfa: boolean; resetPasswords: boolean }
): Promise<DemoSeedRow[]> => {
  if (options.production || process.env.NODE_ENV === "production") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Refusing to create demo staff accounts in production. Dev demo credentials never go to production."
    );
  }

  const staff = await prepare(container);
  const entries: {
    roleKey: RoleKey | null;
    email: string;
    firstName: string;
    lastName: string;
  }[] = [
    ...DEMO_STAFF.map((entry) => ({ ...entry })),
    { roleKey: null, ...DEMO_NO_ROLE_USER },
  ];

  const rows: DemoSeedRow[] = [];
  for (const entry of entries) {
    let user = await findUserByEmail(container, entry.email);
    let password: string | null = null;
    let created = false;

    if (!user) {
      password = demoPassword();
      await createUserWithIdentity(container, {
        email: entry.email,
        password,
        firstName: entry.firstName,
        lastName: entry.lastName,
      });
      created = true;
      user = await findUserByEmail(container, entry.email);
    } else {
      const identity = await findEmailpassIdentity(container, entry.email);
      if (!identity) {
        password = demoPassword();
        const identityId = await registerIdentity(container, entry.email, password);
        await linkIdentity(container, identityId, user.id);
      } else if (options.resetPasswords) {
        password = demoPassword();
        await setPassword(container, entry.email, password);
      } else if (!identity.linkedUserId) {
        await linkIdentity(container, identity.id, user.id);
      }
    }
    if (!user) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `The demo user ${entry.email} could not be read back.`
      );
    }

    // Each demo user holds exactly its own role, and the no-role user holds none.
    const wanted: string[] = entry.roleKey ? [entry.roleKey] : [];
    const existing = await staff.listStaffAssignments({ user_id: user.id });
    const stale = existing.filter(
      (assignment) => !assignment.is_break_glass && !wanted.includes(assignment.role_key)
    );
    if (stale.length > 0) {
      await staff.deleteStaffAssignments(stale.map((assignment) => assignment.id));
    }
    if (entry.roleKey && !existing.some((assignment) => assignment.role_key === entry.roleKey)) {
      await staff.createStaffAssignments({
        user_id: user.id,
        role_key: entry.roleKey,
        is_break_glass: false,
        assigned_by: "seed",
      });
    }

    const identityAfter = await findEmailpassIdentity(container, entry.email);
    if (options.resetMfa && identityAfter && !created) {
      await removeMfaFactors(container, identityAfter.id);
    }
    // Spike S3 does not allow creating a verified factor without a TOTP library
    // in this recovery path, so demo users start not enrolled.
    const mfa = identityAfter ? await mfaStateOf(container, identityAfter.id) : "unknown";

    rows.push({
      role: entry.roleKey ?? "no-role",
      email: entry.email,
      password,
      mfa,
      created,
    });
  }

  // The admin the test data seed creates holds no staff role, and default deny would
  // block it everywhere. This function refuses to run in production (above), so the
  // grant below can never reach a production database. The password stays the one the
  // test data seed recorded, so this row never carries one.
  const testDataAdmin = await findUserByEmail(container, DEMO_TEST_DATA_ADMIN_EMAIL);
  if (testDataAdmin) {
    const held = await staff.listStaffAssignments({ user_id: testDataAdmin.id });
    if (!held.some((assignment) => assignment.role_key === "superadmin")) {
      await staff.createStaffAssignments({
        user_id: testDataAdmin.id,
        role_key: "superadmin",
        is_break_glass: false,
        assigned_by: "seed",
      });
    }
    const adminIdentity = await findEmailpassIdentity(container, DEMO_TEST_DATA_ADMIN_EMAIL);
    if (options.resetMfa && adminIdentity) {
      await removeMfaFactors(container, adminIdentity.id);
    }
    rows.push({
      role: "superadmin",
      email: DEMO_TEST_DATA_ADMIN_EMAIL,
      password: null,
      mfa: adminIdentity ? await mfaStateOf(container, adminIdentity.id) : "unknown",
      created: false,
    });
  }
  return rows;
};
