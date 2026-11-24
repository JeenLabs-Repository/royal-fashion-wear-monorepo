import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";
import type { IUserModuleService } from "@medusajs/framework/types";
import { STAFF_ACCESS_MODULE } from "../../src/modules/staff-access";
import {
  ACTOR_KEYS,
  createActor,
  createStaffUser,
  probe,
  rawProbe,
  randomEmail,
  sessionCookieFor,
  staffHeaders,
  waitForAuditEntry,
} from "../helpers/staff-users";

jest.setTimeout(120 * 1000);

const UNMAPPED_PATHS = ["/admin/zzz-unmapped", "/admin/zzz-unmapped/deep/path"];
const METHODS = ["GET", "POST", "DELETE"];

type StaffAccessApi = {
  listStaffAssignments(filter: Record<string, unknown>): Promise<unknown[]>;
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("default deny", () => {
      test.each(ACTOR_KEYS)("an unmapped admin path for %s", async (key) => {
        const user = await createActor(getContainer(), key);
        const headers = await staffHeaders(api, user);

        for (const path of UNMAPPED_PATHS) {
          for (const method of METHODS) {
            const result = await probe(api, headers, method, path, method === "POST" ? {} : undefined);
            if (key === "superadmin") {
              // Allowed through the permission layer, then nothing serves the path.
              expect({ method, path, status: result.status }).toEqual({ method, path, status: 404 });
            } else if (key === "no_role") {
              expect({ method, path, status: result.status, code: result.code }).toEqual({
                method,
                path,
                status: 403,
                code: "no_staff_role",
              });
            } else {
              expect({ method, path, status: result.status, code: result.code }).toEqual({
                method,
                path,
                status: 403,
                code: "permission_denied",
              });
            }
          }
        }
      });

      test("an unauthenticated call to an unmapped path gets 401", async () => {
        for (const path of UNMAPPED_PATHS) {
          const result = await probe(api, {}, "GET", path);
          expect(result.status).toBe(401);
        }
      });

      test("a path with a dot segment is refused as invalid", async () => {
        const user = await createActor(getContainer(), "superadmin");
        const headers = await staffHeaders(api, user);
        const result = await rawProbe(api, headers, "GET", "/admin/%2e%2e/products");
        expect(result.status).toBe(400);
        expect(result.code).toBe("invalid_path");
      });

      test("a valid incoming request id is echoed and an invalid one is replaced", async () => {
        const user = await createActor(getContainer(), "superadmin");
        const headers = await staffHeaders(api, user);

        const echoed = await probe(api, { ...headers, "x-request-id": "request-id-12345" }, "GET", "/admin/users/me");
        expect(echoed.headers["x-request-id"]).toBe("request-id-12345");

        const replaced = await probe(api, { ...headers, "x-request-id": "bad id!" }, "GET", "/admin/users/me");
        expect(replaced.headers["x-request-id"]).not.toBe("bad id!");
        expect(String(replaced.headers["x-request-id"])).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
      });
    });

    describe("replay after a staff user is deleted", () => {
      test("an old bearer token and cookie session are refused, with leftover assignments in place", async () => {
        const container = getContainer();
        const staff = container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);
        const users = container.resolve<IUserModuleService>(Modules.USER);

        const superadmin = await createStaffUser(container, {
          email: randomEmail("superadmin"),
          roleKeys: ["superadmin"],
        });
        const adminHeaders = await staffHeaders(api, superadmin);

        const routeDeleted = await createStaffUser(container, { email: randomEmail("support"), roleKeys: ["support"] });
        const serviceDeleted = await createStaffUser(container, { email: randomEmail("support"), roleKeys: ["support"] });
        const control = await createStaffUser(container, { email: randomEmail("support"), roleKeys: ["support"] });

        // Credentials captured before deletion: a bearer token and a cookie session each.
        const credentials = new Map<string, Array<Record<string, string>>>();
        for (const user of [routeDeleted, serviceDeleted]) {
          const bearer = await staffHeaders(api, user);
          const cookie = await sessionCookieFor(api, bearer);
          credentials.set(user.id, [bearer, cookie]);

          // Both credentials work before the deletion. The support role holds
          // orders:read, not catalog:read, so orders is the allowed probe.
          for (const headers of [bearer, cookie]) {
            const orders = await probe(api, headers, "GET", "/admin/orders");
            expect([401, 403]).not.toContain(orders.status);
            const me = await probe(api, headers, "GET", "/admin/staff/me");
            expect([401, 403]).not.toContain(me.status);
          }
        }

        // Deleted through the core route, and directly through the module.
        const deleted = await probe(api, adminHeaders, "DELETE", `/admin/users/${routeDeleted.id}`);
        expect(deleted.status).toBe(200);
        await users.deleteUsers([serviceDeleted.id]);

        // The stale-assignment case: the role rows are still there.
        for (const user of [routeDeleted, serviceDeleted]) {
          expect((await staff.listStaffAssignments({ user_id: user.id })).length).toBeGreaterThan(0);
        }

        const replayed = [
          { method: "GET", path: "/admin/orders" },
          { method: "GET", path: "/admin/users/me" },
          { method: "GET", path: "/admin/staff/me" },
          { method: "POST", path: "/admin/product-tags", body: { value: "replay" } },
        ];
        for (const user of [routeDeleted, serviceDeleted]) {
          for (const headers of credentials.get(user.id) ?? []) {
            for (const attempt of replayed) {
              const result = await probe(api, headers, attempt.method, attempt.path, attempt.body);
              expect({ user: user.id, ...attempt, status: result.status, code: result.code }).toEqual({
                user: user.id,
                ...attempt,
                status: 401,
                code: "staff_user_not_found",
              });
            }
          }
        }

        // A user who was not deleted still works in the same run.
        const stillThere = await probe(api, await staffHeaders(api, control), "GET", "/admin/orders");
        expect([401, 403]).not.toContain(stillThere.status);

        // The refusal is recorded for the deleted user, with no label.
        const entry = await waitForAuditEntry(
          container,
          (row) => row.action === "admin.denied" && row.actor_id === routeDeleted.id
        );
        expect(entry).not.toBeNull();
        expect(entry?.actor_label).toBeNull();
        expect(entry?.meta?.code).toBe("staff_user_not_found");
      });
    });
  },
});
