// Helpers for HTTP tests of the staff permission chain.
//
// Everything that depends on how the auth module is driven (registering an
// identity with a password, minting a token for an enrolled identity, switching
// the two-step sign-in state) is isolated in this file. Test setup creates role
// assignments directly through the staffAccess service; production code changes
// roles only through the assign and revoke workflows.

import http from "node:http";
import { randomBytes } from "node:crypto";
import type {
  ConfigModule,
  IAuthModuleService,
  IUserModuleService,
  MedusaContainer,
} from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import { validateRoleCombination } from "../../src/lib/rbac/access";
import { AUDIT_LOG_MODULE } from "../../src/modules/audit-log";
import { STAFF_ACCESS_MODULE } from "../../src/modules/staff-access";
import { signToken } from "./create-admin-user";

// An obviously fake password, used only by these tests.
export const TEST_PASSWORD = "Test-only-password-1!";

export const ACTOR_KEYS = [
  "superadmin",
  "catalog_approver",
  "order_router",
  "support",
  "finance_readonly",
  "no_role",
] as const;
export type ActorKey = (typeof ACTOR_KEYS)[number];

/** The test client of the runner, typed loosely so any axios version fits. */
export type ApiClient = {
  defaults: { baseURL?: string };
  request: (config: never) => Promise<unknown>;
};

type RawResponse = { status: number; data: unknown; headers: Record<string, unknown> };

export type ProbeResult = {
  status: number;
  code: string | undefined;
  body: Record<string, unknown> | undefined;
  headers: Record<string, unknown>;
};

export type StaffUser = {
  id: string;
  email: string;
  password: string;
  identityId: string;
  roleKeys: string[];
  isBreakGlass: boolean;
  /** Mutated by setMfaEnrolled; read when a token is minted. */
  mfaEnrolled: boolean;
  /** The signing secret of the test app, kept so headers can be minted without the container. */
  tokenSecret: string;
};

type StaffAccessApi = {
  createStaffAssignments(rows: Array<Record<string, unknown>>): Promise<unknown>;
  deleteStaffAssignments(ids: string[]): Promise<unknown>;
  listStaffAssignments(filter: Record<string, unknown>, config?: Record<string, unknown>): Promise<
    Array<{ id: string; user_id: string; role_key: string; is_break_glass: boolean }>
  >;
};

export const randomEmail = (label: string): string =>
  `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${randomBytes(4).toString("hex")}@example.com`;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const readSecret = (container: MedusaContainer): string => {
  const config = container.resolve<ConfigModule>(ContainerRegistrationKeys.CONFIG_MODULE);
  const secret = config.projectConfig.http.jwtSecret;
  // Token helpers take a string. Tests always configure a string secret.
  if (typeof secret !== "string" || secret.length === 0) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The test app has no jwtSecret");
  }
  return secret;
};

/** Registers an emailpass identity with a password. Returns its id. */
async function registerIdentity(
  container: MedusaContainer,
  email: string,
  password: string
): Promise<string> {
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  // Spike S5: auth.register("emailpass", { body: { email, password } })
  const result = (await auth.register("emailpass", { body: { email, password } } as never)) as {
    success: boolean;
    authIdentity?: { id: string };
    error?: string;
  };
  if (!result.success || !result.authIdentity) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Could not register the test identity: ${result.error ?? "unknown error"}`
    );
  }
  return result.authIdentity.id;
}

export async function createStaffUser(
  container: MedusaContainer,
  options: {
    email?: string;
    roleKeys?: string[];
    password?: string;
    breakGlass?: boolean;
    mfaEnrolled?: boolean;
  } = {}
): Promise<StaffUser> {
  const breakGlass = options.breakGlass ?? false;
  const roleKeys = options.roleKeys ?? (breakGlass ? ["superadmin"] : []);
  const email = options.email ?? randomEmail(roleKeys[0] ?? "no-role");
  const password = options.password ?? TEST_PASSWORD;

  const combination = validateRoleCombination(roleKeys);
  if (combination) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Invalid test roles: ${combination}`);
  }

  const users = container.resolve<IUserModuleService>(Modules.USER);
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  const staff = container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);

  const user = await users.createUsers({ email });
  const identityId = await registerIdentity(container, email, password);
  await auth.updateAuthIdentities({ id: identityId, app_metadata: { user_id: user.id } });

  if (breakGlass) {
    // Only one break-glass assignment can exist. Test setup clears a leftover one
    // so a test never depends on whether the runner reset the database.
    const leftover = await staff.listStaffAssignments({ is_break_glass: true }, { take: null });
    if (leftover.length > 0) {
      await staff.deleteStaffAssignments(leftover.map((row) => row.id));
    }
  }

  if (roleKeys.length > 0) {
    await staff.createStaffAssignments(
      roleKeys.map((roleKey) => ({
        user_id: user.id,
        role_key: roleKey,
        is_break_glass: breakGlass,
        assigned_by: "test",
      }))
    );
  }

  const created: StaffUser = {
    id: user.id,
    email,
    password,
    identityId,
    roleKeys,
    isBreakGlass: breakGlass,
    mfaEnrolled: options.mfaEnrolled ?? true,
    tokenSecret: readSecret(container),
  };
  await applyMfaFactorState(container, created, created.mfaEnrolled);
  return created;
}

/**
 * Wraps a user that something else created, a recovery script for example, so a
 * test can mint its tokens. The sign-in identity is looked up by email.
 */
export async function adoptStaffUser(
  container: MedusaContainer,
  input: {
    id: string;
    email: string;
    password: string;
    roleKeys?: string[];
    mfaEnrolled?: boolean;
  }
): Promise<StaffUser> {
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  // The same filter shape the staff list helper uses to find identities by email.
  const [identity] = await auth.listAuthIdentities(
    { provider_identities: { provider: "emailpass", entity_id: [input.email] } } as never,
    { take: 1 }
  );
  if (!identity) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No sign-in identity exists for the adopted test user"
    );
  }
  const adopted: StaffUser = {
    id: input.id,
    email: input.email,
    password: input.password,
    identityId: identity.id,
    roleKeys: input.roleKeys ?? [],
    isBreakGlass: false,
    mfaEnrolled: input.mfaEnrolled ?? true,
    tokenSecret: readSecret(container),
  };
  await applyMfaFactorState(container, adopted, adopted.mfaEnrolled);
  return adopted;
}

/** Creates the user for one of the six standard actors. */
export function createActor(container: MedusaContainer, key: ActorKey): Promise<StaffUser> {
  return createStaffUser(container, {
    email: randomEmail(key),
    roleKeys: key === "no_role" ? [] : [key],
  });
}

/**
 * Switches the server-side two-step sign-in state of a user.
 * Spike S3: the enrolment flag is read from auth_context.mfa_enabled on the JWT
 * (with a listAuthMfa fallback the middleware does not use for our gate). Tests
 * mint the claim in mintStaffToken, so no Auth module factor row is required.
 */
async function applyMfaFactorState(
  _container: MedusaContainer,
  _user: StaffUser,
  _enrolled: boolean
): Promise<void> {
  return;
}

export async function setMfaEnrolled(
  container: MedusaContainer,
  user: StaffUser,
  enrolled: boolean
): Promise<void> {
  user.mfaEnrolled = enrolled;
  await applyMfaFactorState(container, user, enrolled);
}

/**
 * A signed token for a user, the way the app signs its own.
 * Spike S3 token recipe: actor_id, actor_type, auth_identity_id, auth_provider,
 * app_metadata, user_metadata, mfa_enabled, mfa_challenge_completed_at.
 */
export function mintStaffToken(user: StaffUser, overrides: Record<string, unknown> = {}): string {
  return signToken(
    {
      actor_id: user.id,
      actor_type: "user",
      auth_identity_id: user.identityId,
      auth_provider: "emailpass",
      app_metadata: { user_id: user.id },
      user_metadata: {},
      mfa_enabled: user.mfaEnrolled,
      mfa_challenge_completed_at: user.mfaEnrolled ? new Date().toISOString() : null,
      ...overrides,
    },
    user.tokenSecret
  );
}

const request = (api: ApiClient, config: Record<string, unknown>): Promise<RawResponse> =>
  (api.request as unknown as (config: object) => Promise<RawResponse>)({
    validateStatus: () => true,
    ...config,
  });

const toProbe = (response: RawResponse): ProbeResult => {
  const body =
    response.data && typeof response.data === "object"
      ? (response.data as Record<string, unknown>)
      : undefined;
  return {
    status: response.status,
    code: typeof body?.code === "string" ? body.code : undefined,
    body,
    headers: response.headers ?? {},
  };
};

/**
 * Authorization headers for a user. An unenrolled user signs in through the
 * real endpoint, so the token carries whatever the server puts in it; an
 * enrolled user gets a minted token.
 */
export async function staffHeaders(
  api: ApiClient,
  user: StaffUser
): Promise<{ authorization: string }> {
  if (!user.mfaEnrolled) {
    const response = await request(api, {
      method: "POST",
      url: "/auth/user/emailpass",
      data: { email: user.email, password: user.password },
    });
    const token = (response.data as { token?: string } | undefined)?.token;
    if (response.status !== 200 || !token) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Sign-in of the test user failed with status ${response.status}`
      );
    }
    return { authorization: `Bearer ${token}` };
  }
  return { authorization: `Bearer ${mintStaffToken(user)}` };
}

/** A cookie session for the user behind these headers (used to replay a session). */
export async function sessionCookieFor(
  api: ApiClient,
  headers: Record<string, string>
): Promise<{ cookie: string }> {
  const response = await request(api, { method: "POST", url: "/auth/session", headers });
  const setCookie = response.headers["set-cookie"] as string[] | undefined;
  if (response.status !== 200 || !setCookie?.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Could not open a cookie session (status ${response.status})`
    );
  }
  return { cookie: setCookie.map((entry) => entry.split(";")[0]).join("; ") };
}

/**
 * Creates a secret API key with a superadmin session and returns headers in the
 * format the spike record proved (S2: Basic with the key as user name, empty password).
 */
export async function secretApiKeyHeaders(
  api: ApiClient,
  superadminHeaders: Record<string, string>
): Promise<{ authorization: string }> {
  const response = await request(api, {
    method: "POST",
    url: "/admin/api-keys",
    headers: superadminHeaders,
    data: { title: `test-key-${randomBytes(3).toString("hex")}`, type: "secret" },
  });
  const token = (response.data as { api_key?: { token?: string } } | undefined)?.api_key?.token;
  if (response.status !== 200 || !token) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Could not create a secret key (status ${response.status})`
    );
  }
  return { authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` };
}

/** One request through the test client; every status is returned, none throws. */
export async function probe(
  api: ApiClient,
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown
): Promise<ProbeResult> {
  return toProbe(await request(api, { method, url: path, headers, data: body }));
}

/**
 * One request with the path sent exactly as written. The test client and the
 * URL parser both rewrite double slashes and dot segments, so odd paths go
 * through node:http. The runner sets api.defaults.baseURL to http://localhost:$port.
 */
export function rawProbe(
  api: ApiClient,
  headers: Record<string, string>,
  method: string,
  rawPath: string,
  body?: unknown
): Promise<ProbeResult> {
  const base = new URL(api.defaults.baseURL ?? "http://localhost:9000");
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        host: base.hostname,
        port: base.port,
        method,
        path: rawPath,
        headers: {
          ...headers,
          ...(payload
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data: unknown;
          try {
            data = text ? JSON.parse(text) : undefined;
          } catch {
            data = undefined;
          }
          resolve(
            toProbe({
              status: incoming.statusCode ?? 0,
              data,
              headers: incoming.headers as Record<string, unknown>,
            })
          );
        });
      }
    );
    outgoing.on("error", reject);
    if (payload) {
      outgoing.write(payload);
    }
    outgoing.end();
  });
}

export type AuditRow = {
  id: string;
  at: string | Date;
  action: string;
  actor_id: string | null;
  actor_type: string;
  actor_label: string | null;
  roles: string[] | null;
  target_type: string | null;
  target_id: string | null;
  before: unknown;
  after: unknown;
  http_method: string | null;
  http_path: string | null;
  http_route: string | null;
  http_status: number | null;
  ip: string | null;
  forwarded_for: string | null;
  user_agent: string | null;
  request_id: string | null;
  meta: Record<string, unknown> | null;
};

type AuditApi = {
  listAuditEntries(
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<AuditRow[]>;
};

/** The newest audit rows, newest first. */
export async function listAuditRows(container: MedusaContainer, take = 500): Promise<AuditRow[]> {
  const audit = container.resolve<AuditApi>(AUDIT_LOG_MODULE);
  return audit.listAuditEntries({}, { order: { at: "DESC" }, take });
}

/**
 * Polls the audit module every 100 ms until a row matches. The HTTP writer runs
 * after the response, so a test cannot read the row at once. Returns null on timeout.
 */
export async function waitForAuditEntry(
  container: MedusaContainer,
  predicate: (row: AuditRow) => boolean,
  timeoutMs = 4000
): Promise<AuditRow | null> {
  const stopAt = Date.now() + timeoutMs;
  for (;;) {
    const found = (await listAuditRows(container)).find(predicate);
    if (found) {
      return found;
    }
    if (Date.now() >= stopAt) {
      return null;
    }
    await sleep(100);
  }
}

/** Superadmins that are not the break-glass account and whose user still exists. */
export async function countRemainingSuperadmins(container: MedusaContainer): Promise<number> {
  const staff = container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const rows = await staff.listStaffAssignments(
    { role_key: "superadmin", is_break_glass: false },
    { take: null }
  );
  const ids = [...new Set(rows.map((row) => row.user_id))];
  if (ids.length === 0) {
    return 0;
  }
  const existing = await users.listUsers({ id: ids }, { select: ["id"], take: null });
  return existing.length;
}

/**
 * A bearer token for a registered identity that is not linked to any user, the
 * state of someone who is accepting an invite. Spike S1: empty actor id, no
 * user_id in app_metadata.
 */
export async function unlinkedIdentityHeaders(
  container: MedusaContainer
): Promise<{ authorization: string }> {
  const email = randomEmail("invitee");
  const identityId = await registerIdentity(container, email, TEST_PASSWORD);
  const token = signToken(
    { actor_id: "", actor_type: "user", auth_identity_id: identityId, app_metadata: {} },
    readSecret(container)
  );
  return { authorization: `Bearer ${token}` };
}

/** Denied means 403 with a permission code; allowed means anything but 401 and 403. */
export const isDenied = (result: ProbeResult): boolean =>
  result.status === 403 &&
  (result.code === "permission_denied" || result.code === "no_staff_role");

export const isAllowed = (result: ProbeResult): boolean =>
  result.status !== 401 && result.status !== 403;
