import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { AUDIT_LOG_MODULE } from "../../src/modules/audit-log";
import { createStaffUser, probe, staffHeaders } from "../helpers/staff-users";

jest.setTimeout(180 * 1000);

const PASSWORD = "Test-only-password-1";
const unique = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}@example.test`;

// Letters only, so the value is a valid action prefix.
const marker = () => {
  let value = "";
  while (value.length < 8) {
    value += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  }
  return value;
};

const COLUMNS = [
  "action",
  "actor_id",
  "actor_label",
  "actor_type",
  "after",
  "at",
  "before",
  "forwarded_for",
  "http_method",
  "http_path",
  "http_route",
  "http_status",
  "id",
  "ip",
  "meta",
  "request_id",
  "roles",
  "target_id",
  "target_type",
  "user_agent",
];

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const superadmin = async () => {
      const user = await createStaffUser(getContainer(), {
        email: unique("audit-super"),
        roleKeys: ["superadmin"],
        password: PASSWORD,
        mfaEnrolled: true,
      });
      return staffHeaders(api, user);
    };

    // Every second entry shares its timestamp with the one before, so the tie-break on id is exercised.
    const seed = async (count: number, prefix: string) => {
      const audit = getContainer().resolve(AUDIT_LOG_MODULE) as unknown as {
        append: (input: Record<string, unknown>) => Promise<unknown>;
      };
      const base = Date.UTC(2026, 0, 1, 0, 0, 0);
      for (let index = 0; index < count; index += 1) {
        await audit.append({
          at: new Date(base + Math.floor(index / 2) * 1000),
          actor_id: `user_seed${index % 3}`,
          actor_type: "user",
          actor_label: index % 2 === 0 ? `alpha-${index}@example.test` : `beta-${index}@example.test`,
          action: `${prefix}.${index % 2 === 0 ? "created" : "updated"}`,
          target_type: "thing",
          target_id: `target_${index % 5}`,
          http_method: "POST",
          http_status: 200,
        });
      }
    };

    describe("GET /admin/audit-log", () => {
      it("pages 120 entries as 50, 50 and 20 with no duplicate ids", async () => {
        const headers = await superadmin();
        const prefix = marker();
        await seed(120, prefix);

        const sizes: number[] = [];
        const seen = new Set<string>();
        let cursor: string | null = null;
        for (let page = 0; page < 5; page += 1) {
          const query = `action_prefix=${prefix}.${cursor ? `&cursor=${cursor}` : ""}`;
          const result = await probe(api, headers, "GET", `/admin/audit-log?${query}`);
          expect(result.status).toBe(200);
          sizes.push(result.body.entries.length);
          for (const entry of result.body.entries) {
            expect(seen.has(entry.id)).toBe(false);
            seen.add(entry.id);
          }
          cursor = result.body.next_cursor;
          if (!cursor) {
            break;
          }
        }
        expect(sizes).toEqual([50, 50, 20]);
        expect(cursor).toBeNull();
        expect(seen.size).toBe(120);
      });

      it("orders newest first by time then id", async () => {
        const headers = await superadmin();
        const prefix = marker();
        await seed(10, prefix);
        const result = await probe(api, headers, "GET", `/admin/audit-log?action_prefix=${prefix}.`);
        const keys = result.body.entries.map(
          (entry: { at: string; id: string }) => `${new Date(entry.at).toISOString()}|${entry.id}`
        );
        expect(keys).toEqual([...keys].sort().reverse());
      });

      it("rejects a limit above 50, a limit of 0, unknown keys and a bad cursor", async () => {
        const headers = await superadmin();
        for (const query of ["limit=51", "limit=0", "export=csv", "cursor=not-a-valid-cursor!"]) {
          const result = await probe(api, headers, "GET", `/admin/audit-log?${query}`);
          expect(result.status).toBe(400);
        }
        const unknown = await probe(api, headers, "GET", "/admin/audit-log?export=csv");
        expect(unknown.code).toBe("invalid_query");
      });

      it("filters by actor, action prefix, target id and date range, alone and together", async () => {
        const headers = await superadmin();
        const prefix = marker();
        await seed(20, prefix);
        const get = async (query: string) =>
          (await probe(api, headers, "GET", `/admin/audit-log?action_prefix=${prefix}.${query}`)).body
            .entries as { actor_id: string; actor_label: string; action: string; target_id: string; at: string }[];

        const byId = await get("&actor=user_seed1");
        expect(byId.length).toBeGreaterThan(0);
        expect(byId.every((entry) => entry.actor_id === "user_seed1")).toBe(true);

        const byLabel = await get("&actor=alpha-");
        expect(byLabel.length).toBe(10);
        expect(byLabel.every((entry) => entry.actor_label.startsWith("alpha-"))).toBe(true);

        const created = await probe(api, headers, "GET", `/admin/audit-log?action_prefix=${prefix}.created`);
        expect(created.body.entries.every((entry: { action: string }) => entry.action.endsWith("created"))).toBe(true);

        const byTarget = await get("&target_id=target_2");
        expect(byTarget.every((entry) => entry.target_id === "target_2")).toBe(true);

        const early = await get("&to=2026-01-01T00:00:02.000Z");
        expect(early.length).toBeGreaterThan(0);
        expect(early.every((entry) => new Date(entry.at) <= new Date("2026-01-01T00:00:02.000Z"))).toBe(true);

        const combined = await get("&actor=alpha-&target_id=target_0");
        expect(combined.length).toBeGreaterThan(0);
        expect(combined.length).toBeLessThan(byLabel.length);
      });

      it("does not let SQL wildcard characters match everything", async () => {
        const headers = await superadmin();
        const prefix = marker();
        await seed(6, prefix);
        for (const actor of ["%", "_", "%25", "alpha-%"]) {
          const result = await probe(
            api,
            headers,
            "GET",
            `/admin/audit-log?action_prefix=${prefix}.&actor=${encodeURIComponent(actor)}`
          );
          expect(result.status).toBe(200);
          expect(result.body.entries).toHaveLength(0);
        }
        const bad = await probe(api, headers, "GET", "/admin/audit-log?action_prefix=%25");
        expect(bad.status).toBe(400);
      });

      it("returns only the audit columns", async () => {
        const headers = await superadmin();
        const prefix = marker();
        await seed(1, prefix);
        const result = await probe(api, headers, "GET", `/admin/audit-log?action_prefix=${prefix}.`);
        expect(Object.keys(result.body.entries[0]).sort()).toEqual(COLUMNS);
      });

      it("answers 403 to every other role and to a user with no role", async () => {
        const roles = ["support", "order_router", "catalog_approver", "finance_readonly"];
        for (const role of roles) {
          const user = await createStaffUser(getContainer(), {
            email: unique(role),
            roleKeys: [role],
            password: PASSWORD,
            mfaEnrolled: true,
          });
          const result = await probe(api, await staffHeaders(api, user), "GET", "/admin/audit-log");
          expect(result.status).toBe(403);
          expect(result.code).toBe("permission_denied");
        }
        const none = await createStaffUser(getContainer(), {
          email: unique("no-role"),
          roleKeys: [],
          password: PASSWORD,
          mfaEnrolled: true,
        });
        const denied = await probe(api, await staffHeaders(api, none), "GET", "/admin/audit-log");
        expect(denied.status).toBe(403);
        expect(denied.code).toBe("no_staff_role");
      });

      it("offers no export and no write method", async () => {
        const headers = await superadmin();
        for (const method of ["POST", "DELETE", "PUT", "PATCH"] as const) {
          const result = await probe(api, headers, method, "/admin/audit-log", {});
          expect(result.status).toBe(404);
        }
        const exported = await probe(api, headers, "GET", "/admin/audit-log/export");
        expect(exported.status).toBe(404);
      });
    });
  },
});
