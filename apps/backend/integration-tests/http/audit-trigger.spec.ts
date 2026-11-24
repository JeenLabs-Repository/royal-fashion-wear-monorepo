import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { recordAudit } from "../../src/lib/audit";
import { AUDIT_LOG_MODULE } from "../../src/modules/audit-log/constants";

jest.setTimeout(120 * 1000);

// Spike S6: dbConnection is a knex instance; raw() returns a result whose
// rows live on `.rows` for some drivers and as the array itself for others.
const rowsOf = (result: any): any[] => result?.rows ?? result ?? [];

medusaIntegrationTestRunner({
  env: {},
  testSuite: ({ getContainer, dbConnection }) => {
    describe("audit_entry is append-only", () => {
      beforeEach(async () => {
        // Runner cleanup may TRUNCATE between suites; re-enable triggers so
        // the body of each test still exercises the append-only guarantees.
        await dbConnection.raw(
          "alter table audit_entry enable trigger user"
        );
        await recordAudit(getContainer(), {
          action: "admin.write",
          actor: { type: "system", label: "integration-test" },
        });
      });

      afterEach(async () => {
        // Let the runner clear tables without hitting the truncate trigger.
        await dbConnection.raw(
          "alter table audit_entry disable trigger user"
        );
      });

      it("accepts an insert through recordAudit", async () => {
        const rows = rowsOf(
          await dbConnection.raw("select count(*)::int as n from audit_entry")
        );
        expect(rows[0].n).toBeGreaterThanOrEqual(1);
      });

      it("rejects UPDATE", async () => {
        await expect(
          dbConnection.raw("update audit_entry set action = 'x'")
        ).rejects.toThrow(/append-only/);
      });

      it("rejects DELETE", async () => {
        await expect(
          dbConnection.raw("delete from audit_entry")
        ).rejects.toThrow(/append-only/);
      });

      it("rejects TRUNCATE", async () => {
        await expect(
          dbConnection.raw("truncate audit_entry")
        ).rejects.toThrow(/append-only/);
      });

      it("runs as the application database role", async () => {
        const rows = rowsOf(
          await dbConnection.raw("select current_user as role")
        );
        const expected =
          process.env.DB_USERNAME ??
          (process.env.DATABASE_URL
            ? decodeURIComponent(new URL(process.env.DATABASE_URL).username)
            : undefined);
        expect(expected).toBeDefined();
        expect(rows[0].role).toBe(expected);
      });

      it("rejects the service update and delete methods", async () => {
        const service = getContainer().resolve(AUDIT_LOG_MODULE) as any;
        await expect(
          service.updateAuditEntries({ id: "aud_x", action: "x" })
        ).rejects.toThrow(/append-only/);
        await expect(service.deleteAuditEntries("aud_x")).rejects.toThrow(
          /append-only/
        );
      });
    });
  },
});
