import { EventEmitter } from "node:events";
import { Modules } from "@medusajs/framework/utils";
import { STAFF_ACCESS_MODULE } from "../../../modules/staff-access";
import {
  GUARD_REGISTRY,
  LOCK_SETTINGS,
  runGuards,
  STAFF_ASSIGNMENTS_LOCK_KEY,
} from "../guards";
import { resolveRule } from "../match-manifest";
import { normalizeAdminPath } from "../normalize-path";
import { PERMISSION_MANIFEST } from "../permission-manifest";
import type { AdminRequest } from "../reject";

type Assignment = { user_id: string; role_key: string; is_break_glass: boolean };
type User = { id: string };

function matches(filter: Record<string, unknown>, row: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, wanted]) =>
    Array.isArray(wanted) ? wanted.includes(row[key]) : row[key] === wanted
  );
}

function makeWorld(users: User[], assignments: Assignment[]) {
  const calls: string[] = [];
  const held = new Map<string, string>();

  const staff = {
    listStaffAssignments: jest.fn(async (filter: Record<string, unknown>) =>
      assignments.filter((row) => matches(filter, row))
    ),
    countNonBreakGlassSuperadmins: jest.fn(async (ids: string[]) => {
      calls.push("count");
      return new Set(
        assignments
          .filter((row) => row.role_key === "superadmin" && !row.is_break_glass && ids.includes(row.user_id))
          .map((row) => row.user_id)
      ).size;
    }),
  };
  const userModule = {
    listUsers: jest.fn(async (filter: { id?: string[] }) =>
      users.filter((user) => (filter.id ?? []).includes(user.id))
    ),
  };
  const locking = {
    acquire: jest.fn(async (keys: string[], args: { ownerId: string }) => {
      for (const key of keys) {
        const owner = held.get(key);
        if (owner !== undefined && owner !== args.ownerId) {
          throw new Error("lock held");
        }
        held.set(key, args.ownerId);
      }
      calls.push("acquire");
    }),
    release: jest.fn(async (keys: string[], args: { ownerId: string }) => {
      for (const key of keys) {
        if (held.get(key) === args.ownerId) {
          held.delete(key);
        }
      }
      calls.push("release");
      return true;
    }),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const stubs: Record<string, unknown> = {
    [STAFF_ACCESS_MODULE]: staff,
    [Modules.USER]: userModule,
    [Modules.LOCKING]: locking,
    logger,
  };

  const removeUser = (id: string) => {
    users.splice(0, users.length, ...users.filter((user) => user.id !== id));
    assignments.splice(0, assignments.length, ...assignments.filter((row) => row.user_id !== id));
  };

  return { staff, userModule, locking, held, calls, scope: { resolve: (key: string) => stubs[key] }, removeUser };
}

type FakeRes = EventEmitter & {
  locals: Record<string, unknown>;
  statusCode: number;
  body?: Record<string, unknown>;
  status(code: number): FakeRes;
  json(body: Record<string, unknown>): FakeRes;
};

function fakeRes(requestId: string): FakeRes {
  const res = new EventEmitter() as FakeRes;
  res.locals = { requestId };
  res.statusCode = 200;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function request(world: ReturnType<typeof makeWorld>, method: string, url: string, requestId: string) {
  const path = normalizeAdminPath(url);
  if (!path.ok) {
    throw new Error("bad test url");
  }
  const res = fakeRes(requestId);
  res.locals.adminRoute = {
    matchPath: path.matchPath,
    casePath: path.casePath,
    rule: resolveRule(PERMISSION_MANIFEST, method, path.matchPath)?.rule ?? null,
  };
  const req = { method, originalUrl: url, url, headers: {}, scope: world.scope } as unknown as AdminRequest;
  return { req, res };
}

async function guarded(world: ReturnType<typeof makeWorld>, method: string, url: string, requestId = "req-1") {
  const { req, res } = request(world, method, url, requestId);
  let nexted = false;
  const done = runGuards(req, res as never, () => {
    nexted = true;
  });
  return { res, done, nextedNow: () => nexted };
}

const superadmin = (user_id: string, is_break_glass = false): Assignment => ({
  user_id,
  role_key: "superadmin",
  is_break_glass,
});
const support = (user_id: string): Assignment => ({ user_id, role_key: "support", is_break_glass: false });

beforeEach(() => {
  LOCK_SETTINGS.timeoutMs = 80;
  LOCK_SETTINGS.pollMs = 5;
});

afterAll(() => {
  LOCK_SETTINGS.timeoutMs = 10_000;
  LOCK_SETTINGS.pollMs = 100;
});

describe("protect-staff-target", () => {
  test("is registered under that name only", () => {
    expect(Object.keys(GUARD_REGISTRY)).toEqual(["protect-staff-target"]);
  });

  test("refuses a break-glass target on every route that carries the guard, without taking the lock", async () => {
    const world = makeWorld(
      [{ id: "bg" }, { id: "a" }],
      [superadmin("bg", true), superadmin("a")]
    );
    for (const [method, url] of [
      ["POST", "/admin/staff/bg/roles"],
      ["DELETE", "/admin/staff/bg/roles/superadmin"],
      ["POST", "/admin/users/bg"],
      ["DELETE", "/admin/users/bg"],
    ]) {
      const { res, done, nextedNow } = await guarded(world, method, url);
      await done;
      expect(nextedNow()).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({ code: "break_glass_protected" });
    }
    expect(world.locking.acquire).not.toHaveBeenCalled();
  });

  test("refuses to delete the only non-break-glass superadmin with last_superadmin", async () => {
    const world = makeWorld([{ id: "bg" }, { id: "a" }], [superadmin("bg", true), superadmin("a")]);
    const { res, done, nextedNow } = await guarded(world, "DELETE", "/admin/users/a");
    await done;
    expect(nextedNow()).toBe(false);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: "last_superadmin" });
  });

  test("allows the delete when another non-break-glass superadmin remains", async () => {
    const world = makeWorld([{ id: "a" }, { id: "b" }], [superadmin("a"), superadmin("b")]);
    const { res, done, nextedNow } = await guarded(world, "DELETE", "/admin/users/a");
    await done;
    expect(nextedNow()).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  test("a superadmin whose user no longer exists does not count", async () => {
    // b has a leftover assignment but no user row.
    const world = makeWorld([{ id: "a" }], [superadmin("a"), superadmin("b")]);
    const { res, done } = await guarded(world, "DELETE", "/admin/users/a");
    await done;
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: "last_superadmin" });
  });

  test("deleting a user who is not a superadmin is allowed", async () => {
    const world = makeWorld([{ id: "a" }, { id: "s" }], [superadmin("a"), support("s")]);
    const { done, nextedNow } = await guarded(world, "DELETE", "/admin/users/s");
    await done;
    expect(nextedNow()).toBe(true);
  });

  test("ids keep their original letter case in lookups", async () => {
    const world = makeWorld([{ id: "UsEr_AbC" }], [support("UsEr_AbC")]);
    const { done } = await guarded(world, "DELETE", "/admin/users/UsEr_AbC");
    await done;
    expect(world.staff.listStaffAssignments).toHaveBeenCalledWith({ user_id: "UsEr_AbC" }, expect.anything());
  });

  test("the delete guard acquires the shared lock before it counts superadmins", async () => {
    const world = makeWorld([{ id: "a" }, { id: "b" }], [superadmin("a"), superadmin("b")]);
    const { done } = await guarded(world, "DELETE", "/admin/users/a");
    await done;
    expect(world.locking.acquire).toHaveBeenCalledWith(
      [STAFF_ASSIGNMENTS_LOCK_KEY],
      expect.objectContaining({ ownerId: "req-1" })
    );
    expect(world.calls.indexOf("acquire")).toBeLessThan(world.calls.indexOf("count"));
  });

  test("the lock is released exactly once on finish, and a later close does not release again", async () => {
    const world = makeWorld([{ id: "a" }, { id: "b" }], [superadmin("a"), superadmin("b")]);
    const { res, done } = await guarded(world, "DELETE", "/admin/users/a");
    await done;
    expect(world.locking.release).not.toHaveBeenCalled();
    res.emit("finish");
    await new Promise((resolve) => setImmediate(resolve));
    res.emit("close");
    await new Promise((resolve) => setImmediate(resolve));
    expect(world.locking.release).toHaveBeenCalledTimes(1);
    expect(world.held.size).toBe(0);
  });

  test("the lock is also released when only close fires", async () => {
    const world = makeWorld([{ id: "a" }, { id: "b" }], [superadmin("a"), superadmin("b")]);
    const { res, done } = await guarded(world, "DELETE", "/admin/users/a");
    await done;
    res.emit("close");
    await new Promise((resolve) => setImmediate(resolve));
    expect(world.locking.release).toHaveBeenCalledTimes(1);
  });

  test("answers 503 staff_lock_busy when the lock never frees", async () => {
    const world = makeWorld([{ id: "a" }, { id: "b" }], [superadmin("a"), superadmin("b")]);
    world.held.set(STAFF_ASSIGNMENTS_LOCK_KEY, "someone-else");
    const { res, done, nextedNow } = await guarded(world, "DELETE", "/admin/users/a");
    await done;
    expect(nextedNow()).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: "staff_lock_busy" });
    expect(world.staff.countNonBreakGlassSuperadmins).not.toHaveBeenCalled();
  });

  test("two deletes started together are serialised: the second sees the first's result", async () => {
    const world = makeWorld([{ id: "a" }, { id: "b" }], [superadmin("a"), superadmin("b")]);
    LOCK_SETTINGS.timeoutMs = 2000;

    const first = await guarded(world, "DELETE", "/admin/users/a", "req-A");
    const second = await guarded(world, "DELETE", "/admin/users/b", "req-B");
    await first.done;
    // The first guard holds the lock, so the second is still waiting.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(first.nextedNow()).toBe(true);
    expect(second.nextedNow()).toBe(false);
    expect(second.res.statusCode).toBe(200);

    // Core deletes the first user, then the response finishes and frees the lock.
    world.removeUser("a");
    first.res.emit("finish");
    await second.done;
    expect(second.nextedNow()).toBe(false);
    expect(second.res.statusCode).toBe(409);
    expect(second.res.body).toMatchObject({ code: "last_superadmin" });
  });

  test("the role routes take no lock in the guard", async () => {
    const world = makeWorld([{ id: "a" }, { id: "b" }], [superadmin("a"), superadmin("b")]);
    const { done, nextedNow } = await guarded(world, "DELETE", "/admin/staff/a/roles/superadmin");
    await done;
    expect(nextedNow()).toBe(true);
    expect(world.locking.acquire).not.toHaveBeenCalled();
  });

  test("a route with no guards passes straight through", async () => {
    const world = makeWorld([], []);
    const { done, nextedNow } = await guarded(world, "GET", "/admin/products");
    await done;
    expect(nextedNow()).toBe(true);
  });

  test("an unknown guard name answers 500 guard_missing", async () => {
    const world = makeWorld([], []);
    const { req, res } = request(world, "GET", "/admin/products", "req-1");
    (res.locals.adminRoute as { rule: unknown }).rule = {
      method: "GET",
      pattern: "/admin/products*",
      permission: "superadmin",
      guards: ["does-not-exist"],
    };
    let nexted = false;
    await runGuards(req, res as never, () => {
      nexted = true;
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ code: "guard_missing" });
  });
});
