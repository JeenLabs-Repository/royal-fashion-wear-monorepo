import { EventEmitter } from "node:events";

jest.mock("../../audit/record-audit", () => ({
  recordAuditSafe: jest.fn(async () => true),
  recordAudit: jest.fn(async () => undefined),
}));

import { Modules } from "@medusajs/framework/utils";
import { recordAuditSafe } from "../../audit/record-audit";
import { STAFF_ACCESS_MODULE } from "../../../modules/staff-access";
import {
  ADMIN_CHAIN_STEPS,
  adminChain,
  chainStep,
  initAdminRequest,
  readTrustProxyHops,
} from "../admin-chain";
import { loadStaffContext } from "../staff-context";
import { requireManifestPermission } from "../require-permission";
import type { AdminRequest } from "../reject";

const recorded = recordAuditSafe as unknown as jest.Mock;

type FakeRes = EventEmitter & {
  locals: Record<string, unknown>;
  statusCode: number;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
  status(code: number): FakeRes;
  json(body: Record<string, unknown>): FakeRes;
  setHeader(name: string, value: string): void;
};

function fakeRes(): FakeRes {
  const res = new EventEmitter() as FakeRes;
  res.locals = {};
  res.statusCode = 200;
  res.headers = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };
  return res;
}

type World = {
  users?: Array<{ id: string; email?: string }>;
  access?: { roleKeys: string[]; permissions: string[]; isBreakGlass: boolean };
  userError?: boolean;
};

function fakeScope(world: World = {}) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const userModule = {
    listUsers: jest.fn(async (filter: { id?: string[] }) => {
      if (world.userError) {
        throw new Error("database down");
      }
      return (world.users ?? []).filter((user) => (filter.id ?? []).includes(user.id));
    }),
  };
  const staffService = {
    resolveEffectiveAccess: jest.fn(async () => ({
      roleKeys: [],
      permissions: [],
      isBreakGlass: false,
      ...world.access,
    })),
  };
  const stubs: Record<string, unknown> = {
    [Modules.USER]: userModule,
    [STAFF_ACCESS_MODULE]: staffService,
    logger,
  };
  return {
    scope: { resolve: (key: string) => stubs[key] },
    userModule,
    staffService,
    logger,
  };
}

function queryFromUrl(url: string): Record<string, string> {
  const queryAt = url.indexOf("?");
  if (queryAt === -1) {
    return {};
  }
  const params = new URLSearchParams(url.slice(queryAt + 1));
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

function fakeReq(init: {
  method?: string;
  url: string;
  auth?: Record<string, unknown> | null;
  scope?: unknown;
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  ip?: string;
}): AdminRequest {
  return {
    method: init.method ?? "GET",
    originalUrl: init.url,
    url: init.url,
    headers: init.headers ?? {},
    body: init.body,
    // Mirror Express: when the caller omits query, derive it from the URL.
    query: init.query ?? queryFromUrl(init.url),
    ip: init.ip ?? "10.0.0.1",
    auth_context: init.auth === null ? undefined : init.auth,
    scope: init.scope ?? fakeScope().scope,
  } as unknown as AdminRequest;
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

async function step(
  handler: (...args: never[]) => unknown,
  req: AdminRequest,
  res: FakeRes
): Promise<{ nexted: boolean; error?: unknown }> {
  const outcome: { nexted: boolean; error?: unknown } = { nexted: false };
  await (handler as (...args: unknown[]) => unknown)(req, res, (error?: unknown) => {
    outcome.nexted = true;
    outcome.error = error;
  });
  return outcome;
}

const auth = (actorId = "user_1") => ({ actor_id: actorId, actor_type: "user", mfa_enabled: true });

beforeEach(() => {
  recorded.mockClear();
});

describe("chain order", () => {
  test("the steps run in the documented order", () => {
    expect(ADMIN_CHAIN_STEPS.map((s) => s.name)).toEqual([
      "init",
      "authenticate",
      "refuse-api-key",
      "mfa-gate",
      "staff-context",
      "permission",
      "guards",
      "audit",
    ]);
    expect(adminChain).toHaveLength(ADMIN_CHAIN_STEPS.length);
  });

  test("only the init and audit steps run for a bypassed request", () => {
    const runners = ADMIN_CHAIN_STEPS.filter((s) => s.options?.runWhenBypassed).map((s) => s.name);
    expect(runners).toEqual(["init", "audit"]);
  });

  test("chainStep skips a step for a bypassed request and forwards a thrown error", async () => {
    const calls: string[] = [];
    const skipped = chainStep(() => {
      calls.push("ran");
    });
    const res = fakeRes();
    res.locals.staffChainBypass = true;
    expect((await step(skipped, fakeReq({ url: "/admin/x" }), res)).nexted).toBe(true);
    expect(calls).toEqual([]);

    const throwing = chainStep(() => {
      throw new Error("boom");
    });
    const outcome = await step(throwing, fakeReq({ url: "/admin/x" }), fakeRes());
    expect(outcome.nexted).toBe(true);
    expect((outcome.error as Error).message).toBe("boom");
  });
});

describe("initAdminRequest", () => {
  test("an invalid path answers 400 invalid_path and stops", async () => {
    const res = fakeRes();
    const outcome = await step(initAdminRequest, fakeReq({ url: "/admin/%2e%2e/x" }), res);
    expect(outcome.nexted).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid_path" });
  });

  test("a valid incoming request id is echoed and an invalid one is replaced", async () => {
    const good = fakeRes();
    await step(initAdminRequest, fakeReq({ url: "/admin/products", headers: { "x-request-id": "abc-12345_X.y" } }), good);
    expect(good.headers["x-request-id"]).toBe("abc-12345_X.y");

    for (const bad of ["short", "has space in it 123", "x".repeat(65), "bad/char/12345"]) {
      const res = fakeRes();
      await step(initAdminRequest, fakeReq({ url: "/admin/products", headers: { "x-request-id": bad } }), res);
      expect(res.headers["x-request-id"]).not.toBe(bad);
      expect(res.headers["x-request-id"]).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    }
  });

  test("OPTIONS bypasses the chain", async () => {
    const res = fakeRes();
    await step(initAdminRequest, fakeReq({ method: "OPTIONS", url: "/admin/products" }), res);
    expect(res.locals.staffChainBypass).toBe(true);
    expect(res.locals.staffChainBypassReason).toBe("options");
  });

  test("POST /admin/invites/accept bypasses as core-handled and POST /admin/invites does not", async () => {
    const accept = fakeRes();
    await step(initAdminRequest, fakeReq({ method: "POST", url: "/admin/invites/accept?token=t" }), accept);
    expect(accept.locals.staffChainBypass).toBe(true);
    expect(accept.locals.staffChainBypassReason).toBe("core-handled");

    const invite = fakeRes();
    await step(initAdminRequest, fakeReq({ method: "POST", url: "/admin/invites" }), invite);
    expect(invite.locals.staffChainBypass).toBeUndefined();
  });

  test("the matched rule and the case-preserving path are stored for later steps", async () => {
    const res = fakeRes();
    await step(initAdminRequest, fakeReq({ method: "GET", url: "/Admin/Users/UsEr_1" }), res);
    const route = res.locals.adminRoute as { casePath: string; rule: { pattern: string } | null };
    expect(route.casePath).toBe("/Admin/Users/UsEr_1");
    expect(route.rule?.pattern).toBe("/admin/users*");
  });
});

describe("requireManifestPermission", () => {
  async function runPermission(method: string, url: string, staff: Record<string, unknown>) {
    const res = fakeRes();
    const req = fakeReq({ method, url, auth: auth() });
    await step(initAdminRequest, req, res);
    res.locals.staff = staff;
    res.locals.armAudit = jest.fn();
    const outcome = await step(requireManifestPermission, req, res);
    return { res, outcome };
  }

  const holder = (roleKeys: string[], permissions: string[]) => ({
    userId: "user_1",
    roleKeys,
    permissions,
    isBreakGlass: false,
  });

  test("an unmapped path needs superadmin: a support user is refused, a superadmin passes", async () => {
    const support = await runPermission("GET", "/admin/zzz-unmapped", holder(["support"], ["orders:read"]));
    expect(support.outcome.nexted).toBe(false);
    expect(support.res.statusCode).toBe(403);
    expect(support.res.body).toMatchObject({ code: "permission_denied" });

    const superadmin = await runPermission("GET", "/admin/zzz-unmapped", holder(["superadmin"], ["staff:manage"]));
    expect(superadmin.outcome.nexted).toBe(true);
  });

  test("a context with no roles gets no_staff_role, except on a self route", async () => {
    const denied = await runPermission("GET", "/admin/products", holder([], []));
    expect(denied.res.statusCode).toBe(403);
    expect(denied.res.body).toMatchObject({ code: "no_staff_role" });

    const self = await runPermission("GET", "/admin/users/me", holder([], []));
    expect(self.outcome.nexted).toBe(true);
  });

  test("a rejection arms the audit writer", async () => {
    const { res } = await runPermission("GET", "/admin/products", holder([], []));
    expect(res.locals.armAudit).toHaveBeenCalled();
  });

  test("a held permission passes and a missing one is refused", async () => {
    const ok = await runPermission("GET", "/admin/orders", holder(["support"], ["orders:read"]));
    expect(ok.outcome.nexted).toBe(true);
    const no = await runPermission("GET", "/admin/products", holder(["support"], ["orders:read"]));
    expect(no.res.statusCode).toBe(403);
  });

  test("a missing staff context fails closed", async () => {
    const res = fakeRes();
    const req = fakeReq({ url: "/admin/products", auth: auth() });
    await step(initAdminRequest, req, res);
    const outcome = await step(requireManifestPermission, req, res);
    expect(outcome.nexted).toBe(false);
    expect(res.statusCode).toBe(500);
  });
});

describe("loadStaffContext", () => {
  test("a user who no longer exists gets 401 staff_user_not_found and the assignments are never read", async () => {
    // The staff service still has a superadmin assignment for this id (a leftover row).
    const world = fakeScope({
      users: [],
      access: { roleKeys: ["superadmin"], permissions: ["staff:manage"], isBreakGlass: false },
    });
    const res = fakeRes();
    const outcome = await step(loadStaffContext, fakeReq({ url: "/admin/products", auth: auth("user_gone"), scope: world.scope }), res);
    expect(outcome.nexted).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: "staff_user_not_found" });
    expect(world.staffService.resolveEffectiveAccess).not.toHaveBeenCalled();
  });

  test("an empty actor id gives the same 401", async () => {
    const world = fakeScope({ users: [{ id: "user_1" }] });
    const res = fakeRes();
    const outcome = await step(loadStaffContext, fakeReq({ url: "/admin/products", auth: { actor_id: "", actor_type: "user" }, scope: world.scope }), res);
    expect(outcome.nexted).toBe(false);
    expect(res.body).toMatchObject({ code: "staff_user_not_found" });
    expect(world.userModule.listUsers).not.toHaveBeenCalled();
  });

  test("a throwing user lookup gives 500 staff_lookup_failed", async () => {
    const world = fakeScope({ userError: true });
    const res = fakeRes();
    const outcome = await step(loadStaffContext, fakeReq({ url: "/admin/products", auth: auth(), scope: world.scope }), res);
    expect(outcome.nexted).toBe(false);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ code: "staff_lookup_failed" });
  });

  test("an existing user passes and the staff context is set", async () => {
    const world = fakeScope({
      users: [{ id: "user_1", email: "a@example.test" }],
      access: { roleKeys: ["support"], permissions: ["returns:decide", "orders:read"], isBreakGlass: false },
    });
    const res = fakeRes();
    const outcome = await step(loadStaffContext, fakeReq({ url: "/admin/orders", auth: auth(), scope: world.scope }), res);
    expect(outcome.nexted).toBe(true);
    expect(res.locals.staff).toEqual({
      userId: "user_1",
      roleKeys: ["support"],
      permissions: ["orders:read", "returns:decide"],
      isBreakGlass: false,
    });
  });

  test("two consecutive requests query the user module twice (no caching)", async () => {
    const world = fakeScope({ users: [{ id: "user_1" }] });
    for (let i = 0; i < 2; i += 1) {
      await step(loadStaffContext, fakeReq({ url: "/admin/orders", auth: auth(), scope: world.scope }), fakeRes());
    }
    expect(world.userModule.listUsers).toHaveBeenCalledTimes(2);
    expect(world.staffService.resolveEffectiveAccess).toHaveBeenCalledTimes(2);
  });
});

describe("audit writer through the chain", () => {
  const canary = "canary-value-do-not-store";

  test("the 401 for a deleted user is recorded as admin.denied with no label and the code in meta", async () => {
    const world = fakeScope({ users: [] });
    const res = fakeRes();
    const req = fakeReq({ method: "GET", url: "/admin/products", auth: auth("user_gone"), scope: world.scope });
    await step(initAdminRequest, req, res);
    await step(loadStaffContext, req, res);
    res.statusCode = 401;
    res.emit("finish");
    await flush();
    expect(recorded).toHaveBeenCalledTimes(1);
    const entry = recorded.mock.calls[0][1];
    expect(entry.action).toBe("admin.denied");
    expect(entry.actor.label).toBeNull();
    expect(entry.actor.id).toBe("user_gone");
    expect(entry.meta.code).toBe("staff_user_not_found");
  });

  test("a denied POST is recorded with key names only", async () => {
    const world = fakeScope({
      users: [{ id: "user_1", email: "a@example.test" }],
      access: { roleKeys: ["finance_readonly"], permissions: ["finance:read"], isBreakGlass: false },
    });
    const res = fakeRes();
    const req = fakeReq({
      method: "POST",
      url: "/admin/products?secret_query=1",
      auth: auth(),
      scope: world.scope,
      body: { title: canary, nested: { value: canary } },
      headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.7", "user-agent": "jest" },
      ip: "10.0.0.7",
    });
    await step(initAdminRequest, req, res);
    await step(loadStaffContext, req, res);
    await step(requireManifestPermission, req, res);
    res.emit("finish");
    await flush();
    expect(recorded).toHaveBeenCalledTimes(1);
    const entry = recorded.mock.calls[0][1];
    expect(JSON.stringify(entry)).not.toContain(canary);
    expect(entry.action).toBe("admin.denied");
    expect(entry.meta.body_keys).toEqual(expect.arrayContaining(["title"]));
    expect(entry.meta.query_keys).toEqual(["secret_query"]);
    expect(entry.meta.code).toBe("permission_denied");
    expect(entry.http).toMatchObject({ method: "POST", path: "/admin/products", route: "/admin/products*", status: 403 });
    expect(entry.ip).toBe("10.0.0.7");
    expect(entry.forwardedFor).toBe("203.0.113.9");
    expect(entry.actor.label).toBe("a@example.test");
    expect(entry.requestId).toBe(res.headers["x-request-id"]);
  });

  test("a break-glass GET is recorded as admin.read and a normal GET is not", async () => {
    for (const [isBreakGlass, expected] of [
      [true, 1],
      [false, 0],
    ] as const) {
      recorded.mockClear();
      const world = fakeScope({
        users: [{ id: "user_1", email: "a@example.test" }],
        access: { roleKeys: ["superadmin"], permissions: ["staff:manage", "orders:read"], isBreakGlass },
      });
      const res = fakeRes();
      const req = fakeReq({ url: "/admin/orders", auth: auth(), scope: world.scope });
      await step(initAdminRequest, req, res);
      await step(loadStaffContext, req, res);
      await step(requireManifestPermission, req, res);
      await step(ADMIN_AUDIT_STEP, req, res);
      res.emit("finish");
      await flush();
      expect(recorded).toHaveBeenCalledTimes(expected);
      if (expected) {
        expect(recorded.mock.calls[0][1].action).toBe("admin.read");
      }
    }
  });

  test("a bypassed invite accept is still recorded, key names only, and an OPTIONS preflight is not", async () => {
    const res = fakeRes();
    const req = fakeReq({
      method: "POST",
      url: "/admin/invites/accept?token=abc",
      auth: { actor_id: "", actor_type: "user" },
      body: { first_name: canary },
    });
    await step(initAdminRequest, req, res);
    for (const wrapped of adminChain.slice(1)) {
      // authenticate and the other middle steps are skipped; the audit step runs.
      await wrapped(req, res as never, () => undefined);
    }
    res.statusCode = 400;
    res.emit("finish");
    await flush();
    expect(recorded).toHaveBeenCalledTimes(1);
    const entry = recorded.mock.calls[0][1];
    expect(entry.action).toBe("admin.write");
    expect(entry.actor.id).toBeNull();
    expect(entry.actor.roles).toEqual([]);
    expect(entry.actor.label).toBeNull();
    expect(entry.http.route).toBe("/admin/invites/accept");
    expect(entry.meta.body_keys).toEqual(["first_name"]);
    expect(JSON.stringify(entry)).not.toContain(canary);

    recorded.mockClear();
    const preflight = fakeRes();
    const optionsReq = fakeReq({ method: "OPTIONS", url: "/admin/products", auth: auth() });
    await step(initAdminRequest, optionsReq, preflight);
    for (const wrapped of adminChain.slice(1)) {
      await wrapped(optionsReq, preflight as never, () => undefined);
    }
    preflight.emit("finish");
    await flush();
    expect(recorded).not.toHaveBeenCalled();
  });

  test("a bypassed request with no auth context records nothing", async () => {
    const res = fakeRes();
    const req = fakeReq({ method: "POST", url: "/admin/invites/accept", auth: null, body: { first_name: "x" } });
    await step(initAdminRequest, req, res);
    for (const wrapped of adminChain.slice(1)) {
      await wrapped(req, res as never, () => undefined);
    }
    res.statusCode = 401;
    res.emit("finish");
    await flush();
    expect(recorded).not.toHaveBeenCalled();
  });
});

const ADMIN_AUDIT_STEP = ADMIN_CHAIN_STEPS.find((s) => s.name === "audit")!.handler as never;

describe("readTrustProxyHops", () => {
  test("defaults to 0 when unset or blank", () => {
    expect(readTrustProxyHops({})).toBe(0);
    expect(readTrustProxyHops({ TRUST_PROXY_HOPS: "  " })).toBe(0);
  });

  test("accepts a non-negative whole number", () => {
    expect(readTrustProxyHops({ TRUST_PROXY_HOPS: "0" })).toBe(0);
    expect(readTrustProxyHops({ TRUST_PROXY_HOPS: "1" })).toBe(1);
    expect(readTrustProxyHops({ TRUST_PROXY_HOPS: " 2 " })).toBe(2);
  });

  test.each(["-1", "one", "1.5", "1e3", "0x1"])("rejects %s", (value) => {
    expect(() => readTrustProxyHops({ TRUST_PROXY_HOPS: value })).toThrow(/TRUST_PROXY_HOPS/);
  });
});
