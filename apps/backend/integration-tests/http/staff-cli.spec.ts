import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { AUDIT_LOG_MODULE } from "../../src/modules/audit-log";
import { STAFF_ACCESS_MODULE } from "../../src/modules/staff-access";
import {
  createBreakGlass,
  grantSuperadmin,
  listStaffRows,
  rotateBreakGlass,
  seedDemoStaff,
} from "../../src/lib/staff-cli/operations";
import { DEMO_NO_ROLE_USER, DEMO_STAFF } from "../../src/lib/dev-seed/demo-staff";
import {
  adoptStaffUser,
  createStaffUser,
  probe,
  setMfaEnrolled,
  staffHeaders,
} from "../helpers/staff-users";

jest.setTimeout(180 * 1000);

const unique = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}@example.test`;

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const login = (email: string, password: string) =>
      api.post("/auth/user/emailpass", { email, password }, { validateStatus: () => true });

    const entries = async (filter: Record<string, unknown>) => {
      const audit = getContainer().resolve(AUDIT_LOG_MODULE) as {
        listAuditEntries: (f: Record<string, unknown>, c?: Record<string, unknown>) => Promise<
          Record<string, unknown>[]
        >;
      };
      return audit.listAuditEntries(filter, { take: 500 });
    };

    const watchLogger = () => {
      const logger = getContainer().resolve(ContainerRegistrationKeys.LOGGER) as unknown as Record<
        "info" | "warn" | "error" | "debug",
        (...args: unknown[]) => void
      >;
      const spies = (["info", "warn", "error", "debug"] as const).map((method) =>
        jest.spyOn(logger, method)
      );
      return () => JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    };

    describe("staff recovery scripts", () => {
      it("grants superadmin to a new email, prints a working password once, and the user reaches the staff route after enrolment", async () => {
        const container = getContainer();
        const email = unique("grant-new");
        const readLogs = watchLogger();

        const result = await grantSuperadmin(container, { email, resetPassword: false });
        expect(result.created).toBe(true);
        expect(result.password).toEqual(expect.any(String));

        const response = await login(email, result.password as string);
        expect(response.status).toBe(200);
        expect(response.data.token).toEqual(expect.any(String));

        // The script made this user, so the helper looks the sign-in identity up and
        // fills the rest of the test user.
        const helperUser = await adoptStaffUser(container, {
          id: result.userId,
          email,
          password: result.password as string,
          roleKeys: ["superadmin"],
          mfaEnrolled: false,
        });
        await setMfaEnrolled(container, helperUser, true);
        const headers = await staffHeaders(api, helperUser);
        const me = await probe(api, headers, "GET", "/admin/staff/me");
        expect(me.status).toBe(200);
        expect(me.body?.roles).toEqual(["superadmin"]);

        expect(readLogs()).not.toContain(result.password as string);
        const all = JSON.stringify(await entries({}));
        expect(all).not.toContain(result.password as string);
      });

      it("moves an existing support user to superadmin and records system actor entries", async () => {
        const container = getContainer();
        const email = unique("grant-existing");
        const user = await createStaffUser(container, {
          email,
          roleKeys: ["support"],
          password: "Test-only-password-1",
          mfaEnrolled: true,
        });

        const result = await grantSuperadmin(container, { email, resetPassword: false });
        expect(result.created).toBe(false);
        expect(result.password).toBeNull();

        const staff = container.resolve(STAFF_ACCESS_MODULE) as {
          resolveEffectiveAccess: (id: string) => Promise<{ roleKeys: string[] }>;
        };
        expect((await staff.resolveEffectiveAccess(user.id)).roleKeys).toEqual(["superadmin"]);

        for (const action of ["staff.role_revoked", "staff.role_assigned", "staff.superadmin_granted"]) {
          const rows = await entries({ action, target_id: user.id });
          expect(rows.length).toBeGreaterThanOrEqual(1);
          expect(rows[0].actor_type).toBe("system");
        }
        const granted = await entries({ action: "staff.superadmin_granted", target_id: user.id });
        expect(Object.keys(granted[0].meta as object).sort()).toEqual(["created_user", "reset_password"]);
      });

      it("resets the password only when asked", async () => {
        const container = getContainer();
        const email = unique("grant-reset");
        const first = await grantSuperadmin(container, { email, resetPassword: false });
        const keep = await grantSuperadmin(container, { email, resetPassword: false });
        expect(keep.password).toBeNull();
        expect((await login(email, first.password as string)).status).toBe(200);

        const reset = await grantSuperadmin(container, { email, resetPassword: true });
        expect(reset.password).not.toBeNull();
        expect(reset.password).not.toBe(first.password);
        expect((await login(email, first.password as string)).status).not.toBe(200);
        expect((await login(email, reset.password as string)).status).toBe(200);
      });

      it("creates one break-glass superadmin, refuses a second and rotates the password and factors", async () => {
        const container = getContainer();
        const email = unique("break-glass");
        const readLogs = watchLogger();

        // Clear a leftover break-glass from another suite so this proof starts clean.
        const staff = container.resolve(STAFF_ACCESS_MODULE) as {
          listStaffAssignments: (
            f: Record<string, unknown>,
            c?: Record<string, unknown>
          ) => Promise<Array<{ id: string; role_key: string; is_break_glass: boolean }>>;
          deleteStaffAssignments: (ids: string[]) => Promise<unknown>;
        };
        const leftover = await staff.listStaffAssignments({ is_break_glass: true }, { take: null });
        if (leftover.length > 0) {
          await staff.deleteStaffAssignments(leftover.map((row) => row.id));
        }

        const created = await createBreakGlass(container, { email });
        expect(created.password).toHaveLength(24);
        expect((await login(email, created.password)).status).toBe(200);

        const marked = await staff.listStaffAssignments({ is_break_glass: true });
        expect(marked).toHaveLength(1);
        expect(marked[0].role_key).toBe("superadmin");

        await expect(createBreakGlass(container, { email: unique("second") })).rejects.toThrow();

        const rotated = await rotateBreakGlass(container);
        expect(rotated.password).toHaveLength(24);
        expect(rotated.password).not.toBe(created.password);
        expect((await login(email, created.password)).status).not.toBe(200);
        expect((await login(email, rotated.password)).status).toBe(200);

        const rotatedEntries = await entries({ action: "break_glass.rotated" });
        expect(rotatedEntries[0].meta).toEqual({ mfa_reset: true });

        const all = JSON.stringify(await entries({}));
        for (const secret of [created.password, rotated.password]) {
          expect(all).not.toContain(secret);
          expect(readLogs()).not.toContain(secret);
        }
      });

      it("lists staff and writes exactly one audit entry that holds a count only", async () => {
        const container = getContainer();
        const email = unique("listed");
        await createStaffUser(container, {
          email,
          roleKeys: ["support"],
          password: "Test-only-password-1",
          mfaEnrolled: true,
        });
        const beforeIds = new Set(
          (await entries({ action: "staff.listed" })).map((row) => row.id)
        );

        const rows = await listStaffRows(container);
        expect(rows.some((row) => row.email === email)).toBe(true);

        const added = (await entries({ action: "staff.listed" })).filter(
          (row) => !beforeIds.has(row.id)
        );
        expect(added).toHaveLength(1);
        const entry = added[0];
        expect((entry.meta as { row_count: number }).row_count).toBe(rows.length);
        expect(entry.actor_type).toBe("system");
        expect(String(entry.actor_label).startsWith("cli:")).toBe(true);
        expect(Object.keys(entry.meta as object)).toEqual(["row_count"]);
        expect(entry.target_type).toBe("staff");
        expect(entry.target_id ?? null).toBeNull();
        const serialized = JSON.stringify(entry);
        expect(serialized).not.toContain(email);
        expect(serialized.toLowerCase()).not.toContain("password");
      });

      it("denies a user created without an assignment, as the stock command would leave them", async () => {
        const container = getContainer();
        const user = await createStaffUser(container, {
          email: unique("no-assignment"),
          roleKeys: [],
          password: "Test-only-password-1",
          mfaEnrolled: true,
        });
        const headers = await staffHeaders(api, user);
        const result = await probe(api, headers, "GET", "/admin/products");
        expect(result.status).toBe(403);
        expect(result.code).toBe("no_staff_role");
      });

      it("seeds one demo user per role plus a no-role user, idempotently, and refuses in production", async () => {
        const container = getContainer();
        const options = { production: false, resetMfa: false, resetPasswords: false };

        const first = await seedDemoStaff(container, options);
        // Drop the optional test-data-admin row so the count matches the five roles plus no-role.
        const demoRows = first.filter((row) => row.email !== "admin@example.test");
        expect(demoRows).toHaveLength(DEMO_STAFF.length + 1);
        expect(demoRows.every((row) => row.created && row.password)).toBe(true);

        const second = await seedDemoStaff(container, options);
        const secondDemo = second.filter((row) => row.email !== "admin@example.test");
        expect(secondDemo.every((row) => !row.created && row.password === null)).toBe(true);

        const rows = await listStaffRows(container);
        for (const entry of DEMO_STAFF) {
          const row = rows.find((candidate) => candidate.email === entry.email);
          expect(row?.roles).toEqual([entry.roleKey]);
        }
        const noRole = rows.find((row) => row.email === DEMO_NO_ROLE_USER.email);
        expect(noRole?.roles).toEqual([]);

        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
          await expect(seedDemoStaff(container, options)).rejects.toThrow(/production/);
        } finally {
          process.env.NODE_ENV = previous;
        }
      });
    });
  },
});
