import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { VENDOR_MODULE } from "../../src/modules/vendor";
import { createFreshVendor, removeFreshVendors } from "../../src/scripts/lib/fresh-vendor";

jest.setTimeout(180_000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const options = () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "fresh-vendor-"));
      return { outDir: dir, credentialsPath: path.join(dir, "TEST-CREDENTIALS.local.md") };
    };

    describe("fresh vendor option of the demo seed", () => {
      it("creates a registered invited vendor with two locations", async () => {
        const fresh = await createFreshVendor(getContainer(), options());
        expect(fresh.status).toBe("invited");
        expect(fresh.name).toMatch(/^Demo Vendor Fresh \d+$/);
        expect(fresh.location_codes).toHaveLength(2);
        for (const code of fresh.location_codes) {
          expect(code).toMatch(/^LOC-\d{4,}$/);
        }
      });

      it("leaves two-factor sign-in not enrolled and the agreement not accepted", async () => {
        const fresh = await createFreshVendor(getContainer(), options());
        const login = await api.post("/auth/vendor/emailpass", {
          email: fresh.email,
          password: fresh.password,
        });
        expect(login.status).toBe(200);
        const headers = { authorization: `Bearer ${login.data.token}` };

        const me = await api.get("/vendor/me", { headers });
        expect(me.status).toBe(200);
        expect(me.data.mfa_enabled).toBe(false);
        expect(me.data.vendor.status).toBe("invited");

        const onboarding = await api.get("/vendor/onboarding", { headers });
        const agreement = onboarding.data.steps.find(
          (step: { key: string }) => step.key === "agreement"
        );
        expect(agreement.complete).toBe(false);
      });

      it("accepts the agreement and activates the vendor with the active option", async () => {
        const fresh = await createFreshVendor(getContainer(), {
          ...options(),
          status: "active",
        });
        expect(fresh.status).toBe("active");
        const login = await api.post("/auth/vendor/emailpass", {
          email: fresh.email,
          password: fresh.password,
        });
        const me = await api.get("/vendor/me", {
          headers: { authorization: `Bearer ${login.data.token}` },
        });
        expect(me.data.vendor.status).toBe("active");
      });

      it("creates a different vendor on every call", async () => {
        const first = await createFreshVendor(getContainer(), options());
        const second = await createFreshVendor(getContainer(), options());
        expect(first.email).not.toBe(second.email);
        expect(first.vendor_id).not.toBe(second.vendor_id);
        expect(first.location_codes).not.toEqual(second.location_codes);
      });

      it("writes the vendor under fresh_vendor and one row into the credentials section", async () => {
        const where = options();
        const fresh = await createFreshVendor(getContainer(), where);
        const seed = JSON.parse(
          readFileSync(path.join(where.outDir, "vendor-seed.json"), "utf8")
        );
        expect(seed.fresh_vendor.email).toBe(fresh.email);

        const credentials = readFileSync(where.credentialsPath, "utf8");
        expect(credentials).toContain("<!-- vendor-fresh:start -->");
        expect(credentials).toContain(fresh.email);
        expect(credentials).toContain("rerun the seed with --reset");
      });

      it("keeps earlier rows when a second vendor is added to the credentials file", async () => {
        const where = options();
        const first = await createFreshVendor(getContainer(), where);
        const second = await createFreshVendor(getContainer(), where);
        const credentials = readFileSync(where.credentialsPath, "utf8");
        expect(credentials).toContain(first.email);
        expect(credentials).toContain(second.email);
        expect(credentials.match(/<!-- vendor-fresh:start -->/g)).toHaveLength(1);
      });

      it("removes every fresh vendor on reset", async () => {
        await createFreshVendor(getContainer(), options());
        await createFreshVendor(getContainer(), options());
        const removed = await removeFreshVendors(getContainer());
        expect(removed).toBeGreaterThanOrEqual(2);

        const service = getContainer().resolve(VENDOR_MODULE) as unknown as {
          listVendors: (filter: Record<string, unknown>) => Promise<unknown[]>;
        };
        expect(
          await service.listVendors({ internal_name: { $like: "Demo Vendor Fresh%" } })
        ).toEqual([]);
      });

      it("refuses to run in production", async () => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
          await expect(createFreshVendor(getContainer(), options())).rejects.toThrow(
            /Refusing to run in production/
          );
        } finally {
          process.env.NODE_ENV = previous;
        }
      });
    });
  },
});
