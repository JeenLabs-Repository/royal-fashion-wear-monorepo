import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { STAFF_ACCESS_MODULE } from "../../src/modules/staff-access";
import { revokeStaffRoleWorkflow } from "../../src/workflows/revoke-staff-role";
import {
  countRemainingSuperadmins,
  createActor,
  createStaffUser,
  isAllowed,
  probe,
  randomEmail,
  staffHeaders,
  waitForAuditEntry,
  type StaffUser,
} from "../helpers/staff-users";

jest.setTimeout(180 * 1000);

type StaffAccessApi = {
  listStaffAssignments(
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<Array<{ role_key: string }>>;
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const superadminCaller = async () => {
      const user = await createActor(getContainer(), "superadmin");
      return { user, headers: await staffHeaders(api, user) };
    };

    const breakGlassCaller = async () => {
      const user = await createStaffUser(getContainer(), {
        email: randomEmail("break-glass"),
        roleKeys: ["superadmin"],
        breakGlass: true,
      });
      return { user, headers: await staffHeaders(api, user) };
    };

    const plainUser = (roleKeys: string[] = []) =>
      createStaffUser(getContainer(), {
        email: randomEmail(roleKeys[0] ?? "no-role"),
        roleKeys,
      });

    describe("assigning and revoking roles", () => {
      test("a superadmin builds up a user's roles and the exclusivity rule holds", async () => {
        const { headers } = await superadminCaller();
        const target = await plainUser();

        const first = await probe(api, headers, "POST", `/admin/staff/${target.id}/roles`, {
          role: "support",
        });
        expect(first.status).toBe(200);
        expect(first.body?.roles).toEqual(["support"]);

        const repeat = await probe(api, headers, "POST", `/admin/staff/${target.id}/roles`, {
          role: "support",
        });
        expect(repeat.status).toBe(400);
        expect(repeat.code).toBe("already_assigned");

        const second = await probe(api, headers, "POST", `/admin/staff/${target.id}/roles`, {
          role: "catalog_approver",
        });
        expect(second.status).toBe(200);
        expect(second.body?.roles).toEqual(["catalog_approver", "support"]);

        const exclusive = await probe(api, headers, "POST", `/admin/staff/${target.id}/roles`, {
          role: "superadmin",
        });
        expect(exclusive.status).toBe(400);
        expect(exclusive.code).toBe("superadmin_exclusive");
      });

      test("a role cannot be added to a superadmin", async () => {
        const { headers } = await superadminCaller();
        const target = await plainUser(["superadmin"]);
        const result = await probe(api, headers, "POST", `/admin/staff/${target.id}/roles`, {
          role: "support",
        });
        expect(result.status).toBe(400);
        expect(result.code).toBe("superadmin_exclusive");
      });

      test("a body with an unknown role or extra keys is a 400", async () => {
        const { headers } = await superadminCaller();
        const target = await plainUser();
        for (const body of [
          { role: "owner" },
          { role: "support", user_id: "x" },
          {},
          { roles: ["support"] },
        ]) {
          const result = await probe(api, headers, "POST", `/admin/staff/${target.id}/roles`, body);
          expect({ body, status: result.status, code: result.code }).toEqual({
            body,
            status: 400,
            code: "invalid_body",
          });
        }
        const unknown = await probe(api, headers, "DELETE", `/admin/staff/${target.id}/roles/owner`);
        expect(unknown.status).toBe(400);
        expect(unknown.code).toBe("unknown_role");
      });

      test("a support user cannot assign or revoke", async () => {
        const caller = await createActor(getContainer(), "support");
        const headers = await staffHeaders(api, caller);
        const target = await plainUser(["order_router"]);

        const assign = await probe(api, headers, "POST", `/admin/staff/${target.id}/roles`, {
          role: "support",
        });
        expect(assign.status).toBe(403);
        expect(assign.code).toBe("permission_denied");

        const revoke = await probe(
          api,
          headers,
          "DELETE",
          `/admin/staff/${target.id}/roles/order_router`
        );
        expect(revoke.status).toBe(403);
        expect(revoke.code).toBe("permission_denied");
      });

      test("revoking a role the user does not hold is a 404", async () => {
        const { headers } = await superadminCaller();
        const target = await plainUser(["support"]);
        const result = await probe(
          api,
          headers,
          "DELETE",
          `/admin/staff/${target.id}/roles/order_router`
        );
        expect(result.status).toBe(404);
        expect(result.code).toBe("not_assigned");
      });

      test("a revoked role takes effect on the user's next request with the same token", async () => {
        const { headers } = await superadminCaller();
        const target = await plainUser(["catalog_approver"]);
        const targetHeaders = await staffHeaders(api, target);

        const before = await probe(api, targetHeaders, "GET", "/admin/products");
        expect(isAllowed(before)).toBe(true);

        const revoked = await probe(
          api,
          headers,
          "DELETE",
          `/admin/staff/${target.id}/roles/catalog_approver`
        );
        expect(revoked.status).toBe(200);

        const after = await probe(api, targetHeaders, "GET", "/admin/products");
        expect(after.status).toBe(403);
      });

      test("each change writes an audit entry with the before and after role lists", async () => {
        const container = getContainer();
        const { user: caller, headers } = await superadminCaller();
        const target = await plainUser();

        await probe(api, headers, "POST", `/admin/staff/${target.id}/roles`, { role: "support" });
        const assigned = await waitForAuditEntry(
          container,
          (row) => row.action === "staff.role_assigned" && row.target_id === target.id
        );
        expect(assigned).not.toBeNull();
        expect(assigned?.actor_id).toBe(caller.id);
        expect(assigned?.before).toEqual({ roles: [] });
        expect(assigned?.after).toEqual({ roles: ["support"] });

        await probe(api, headers, "DELETE", `/admin/staff/${target.id}/roles/support`);
        const revoked = await waitForAuditEntry(
          container,
          (row) => row.action === "staff.role_revoked" && row.target_id === target.id
        );
        expect(revoked).not.toBeNull();
        expect(revoked?.before).toEqual({ roles: ["support"] });
        expect(revoked?.after).toEqual({ roles: [] });
      });
    });

    describe("the break-glass account", () => {
      test("cannot be changed or deleted through any route", async () => {
        const { headers } = await superadminCaller();
        const breakGlass = await createStaffUser(getContainer(), {
          email: randomEmail("break-glass"),
          roleKeys: ["superadmin"],
          breakGlass: true,
        });

        const attempts: Array<[string, string, Record<string, unknown>?]> = [
          ["POST", `/admin/staff/${breakGlass.id}/roles`, { role: "support" }],
          ["DELETE", `/admin/staff/${breakGlass.id}/roles/superadmin`],
          ["POST", `/admin/users/${breakGlass.id}`, { first_name: "Changed" }],
          ["DELETE", `/admin/users/${breakGlass.id}`],
        ];
        for (const [method, path, body] of attempts) {
          const result = await probe(api, headers, method, path, body);
          expect({ method, path, status: result.status, code: result.code }).toEqual({
            method,
            path,
            status: 403,
            code: "break_glass_protected",
          });
        }
      });

      test("is refused by the revoke workflow itself, even for a system actor", async () => {
        const breakGlass = await createStaffUser(getContainer(), {
          email: randomEmail("break-glass"),
          roleKeys: ["superadmin"],
          breakGlass: true,
        });
        await expect(
          revokeStaffRoleWorkflow(getContainer()).run({
            input: {
              user_id: breakGlass.id,
              role: "superadmin",
              actor: { id: "cli", type: "system", label: "cli:test" },
            },
          })
        ).rejects.toMatchObject({ code: "break_glass_protected" });
      });
    });

    describe("the last superadmin", () => {
      test("cannot lose the role or be deleted; the break-glass account does not count", async () => {
        const { headers } = await breakGlassCaller();
        const first = await plainUser(["superadmin"]);

        const revoke = await probe(
          api,
          headers,
          "DELETE",
          `/admin/staff/${first.id}/roles/superadmin`
        );
        expect(revoke.status).toBe(409);
        expect(revoke.code).toBe("last_superadmin");

        const second = await plainUser(["superadmin"]);
        const allowed = await probe(
          api,
          headers,
          "DELETE",
          `/admin/staff/${first.id}/roles/superadmin`
        );
        expect(allowed.status).toBe(200);

        const del = await probe(api, headers, "DELETE", `/admin/users/${second.id}`);
        expect(del.status).toBe(409);
        expect(del.code).toBe("last_superadmin");
      });

      // Each case runs with both start orders, so neither ordering can leave zero superadmins.
      describe.each([false, true])("concurrent changes (swapped order: %s)", (swapped) => {
        const race = async (
          first: () => Promise<{ status: number; code?: string }>,
          second: () => Promise<{ status: number; code?: string }>
        ) => {
          const results = await Promise.all(swapped ? [second(), first()] : [first(), second()]);
          return swapped ? [results[1], results[0]] : results;
        };

        const summarise = (results: Array<{ status: number; code?: string }>) => ({
          successes: results.filter((r) => r.status === 200).length,
          conflicts: results.filter((r) => r.status === 409 && r.code === "last_superadmin")
            .length,
        });

        test("revoke against revoke leaves exactly one superadmin", async () => {
          const container = getContainer();
          const { headers } = await breakGlassCaller();
          const a = await plainUser(["superadmin"]);
          const b = await plainUser(["superadmin"]);

          const results = await race(
            () => probe(api, headers, "DELETE", `/admin/staff/${a.id}/roles/superadmin`),
            () => probe(api, headers, "DELETE", `/admin/staff/${b.id}/roles/superadmin`)
          );
          expect(summarise(results)).toEqual({ successes: 1, conflicts: 1 });
          expect(await countRemainingSuperadmins(container)).toBe(1);
        });

        test("delete against revoke leaves exactly one superadmin", async () => {
          const container = getContainer();
          const { headers } = await breakGlassCaller();
          const a = await plainUser(["superadmin"]);
          const b = await plainUser(["superadmin"]);

          const results = await race(
            () => probe(api, headers, "DELETE", `/admin/users/${a.id}`),
            () => probe(api, headers, "DELETE", `/admin/staff/${b.id}/roles/superadmin`)
          );
          expect(summarise(results)).toEqual({ successes: 1, conflicts: 1 });
          expect(await countRemainingSuperadmins(container)).toBe(1);
        });

        test("delete against delete leaves exactly one superadmin and one of the two users", async () => {
          const container = getContainer();
          const users = container.resolve<IUserModuleService>(Modules.USER);
          const { headers } = await breakGlassCaller();
          const a = await plainUser(["superadmin"]);
          const b = await plainUser(["superadmin"]);

          const results = await race(
            () => probe(api, headers, "DELETE", `/admin/users/${a.id}`),
            () => probe(api, headers, "DELETE", `/admin/users/${b.id}`)
          );
          expect(summarise(results)).toEqual({ successes: 1, conflicts: 1 });
          expect(await countRemainingSuperadmins(container)).toBe(1);
          const existing = await users.listUsers({ id: [a.id, b.id] }, { select: ["id"] });
          expect(existing).toHaveLength(1);
        });
      });
    });

    describe("reading staff", () => {
      test("the list shows roles, the break-glass flag and a two-step state; support is refused", async () => {
        const { user: caller, headers } = await superadminCaller();
        const support: StaffUser = await plainUser(["support"]);

        const result = await probe(api, headers, "GET", "/admin/staff");
        expect(result.status).toBe(200);
        const rows = (result.body?.staff ?? []) as Array<Record<string, unknown>>;
        const own = rows.find((row) => row.user_id === caller.id);
        const other = rows.find((row) => row.user_id === support.id);
        expect(own?.roles).toEqual(["superadmin"]);
        expect(other?.roles).toEqual(["support"]);
        for (const row of rows) {
          expect(Object.keys(row).sort()).toEqual([
            "email",
            "first_name",
            "is_break_glass",
            "last_name",
            "mfa_state",
            "roles",
            "user_id",
          ]);
          expect(["enrolled", "not_enrolled", "unknown"]).toContain(row.mfa_state);
          expect(typeof row.is_break_glass).toBe("boolean");
        }
        expect(result.body).toMatchObject({ limit: 100, offset: 0 });

        const refused = await probe(api, await staffHeaders(api, support), "GET", "/admin/staff");
        expect(refused.status).toBe(403);
        expect(refused.code).toBe("permission_denied");
      });

      test("the list rejects an unknown or out-of-range query", async () => {
        const { headers } = await superadminCaller();
        for (const query of ["?limit=0", "?limit=500", "?offset=-1", "?color=red"]) {
          const result = await probe(api, headers, "GET", `/admin/staff${query}`);
          expect({ query, status: result.status, code: result.code }).toEqual({
            query,
            status: 400,
            code: "invalid_query",
          });
        }
      });

      test("me answers for a user with no role and lists the permissions of a support user", async () => {
        const noRole = await plainUser();
        const none = await probe(api, await staffHeaders(api, noRole), "GET", "/admin/staff/me");
        expect(none.status).toBe(200);
        expect(none.body).toMatchObject({ access: "no_role", roles: [], permissions: [] });

        const support = await plainUser(["support"]);
        const some = await probe(api, await staffHeaders(api, support), "GET", "/admin/staff/me");
        expect(some.status).toBe(200);
        expect(some.body).toMatchObject({
          access: "granted",
          roles: ["support"],
          is_break_glass: false,
        });
        expect(some.body?.permissions).toEqual(expect.arrayContaining(["returns:decide"]));
        expect(some.body?.email).toBe(support.email);
      });
    });

    // Used by the cleanup check below: assignments left by a deleted user do not count.
    describe("leftover assignments", () => {
      test("a deleted user's leftover superadmin row does not count towards the last-superadmin rule", async () => {
        const container = getContainer();
        const staff = container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);
        const users = container.resolve<IUserModuleService>(Modules.USER);
        const { headers } = await breakGlassCaller();
        const gone = await plainUser(["superadmin"]);
        const remaining = await plainUser(["superadmin"]);

        await users.deleteUsers([gone.id]);
        expect((await staff.listStaffAssignments({ user_id: gone.id })).length).toBe(1);

        const result = await probe(
          api,
          headers,
          "DELETE",
          `/admin/staff/${remaining.id}/roles/superadmin`
        );
        expect(result.status).toBe(409);
        expect(result.code).toBe("last_superadmin");
      });
    });
  },
});
