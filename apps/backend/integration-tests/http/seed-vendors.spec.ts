import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import seedVendors, { applyMarkedBlock } from "../../src/scripts/seed-vendors";
import { DEMO_VENDORS } from "../../src/scripts/demo-data/vendors";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { ensureDefaultSalesChannel, vendorLogin } from "../helpers/vendor-fixtures";

jest.setTimeout(300 * 1000);

const MARK_START = "<!-- vendor-seed:start -->";
const MARK_END = "<!-- vendor-seed:end -->";

type Query = {
  graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("demo vendor seed", () => {
      let outDir: string;

      beforeEach(async () => {
        outDir = mkdtempSync(path.join(os.tmpdir(), "vendor-seed-"));
        await ensureDefaultSalesChannel(getContainer());
      });

      afterEach(() => {
        rmSync(outDir, { recursive: true, force: true });
      });

      const run = (...extra: string[]) =>
        seedVendors({
          container: getContainer(),
          args: ["--out-dir", outDir, ...extra],
        } as never);

      const manifest = () =>
        JSON.parse(readFileSync(path.join(outDir, "e2e", ".auth", "vendor-seed.json"), "utf8"));

      it("creates the five demo vendors in their states", async () => {
        const summary = await run();
        expect(summary.created).toHaveLength(5);

        const data = manifest();
        expect(data.vendors.alpha.status).toBe("active");
        expect(data.vendors.alpha.locations.map((l: { state_code: string }) => l.state_code)).toEqual(
          expect.arrayContaining(["IN-MH", "IN-KA"])
        );
        expect(data.vendors.bravo.status).toBe("active");
        expect(data.vendors.bravo.locations).toHaveLength(1);
        expect(data.vendors.charlie).toMatchObject({
          status: "invited",
          registered: true,
          agreement_accepted: false,
        });
        expect(data.vendors.delta.status).toBe("suspended");
        expect(data.vendors.echo).toMatchObject({ status: "invited", registered: false });
        expect(data.vendors.echo.accept_url).toContain("#token=");
      });

      it("lets registered demo vendors sign in with the recorded passwords", async () => {
        await run();
        const alpha = DEMO_VENDORS.find((vendor) => vendor.key === "alpha")!;
        const token = await vendorLogin(api, { email: alpha.email, password: alpha.password });
        expect(token.split(".")).toHaveLength(3);
      });

      it("creates no duplicates when run twice", async () => {
        await run();
        const container = getContainer();
        const countVendors = async () =>
          (
            await getVendorModule(container).listVendors(
              { internal_name: { $like: "Demo Vendor %" } },
              { take: null }
            )
          ).length;
        const before = await countVendors();

        const second = await run();

        expect(second.created).toEqual([]);
        expect(second.existing).toHaveLength(5);
        expect(await countVendors()).toBe(before);
        expect(manifest().vendors.echo.accept_url).toContain("#token=");
      });

      it("adds one more invited vendor each time the fresh invite option is used", async () => {
        await run();
        const first = await run("--fresh-invite");
        const second = await run("--fresh-invite");

        expect(first.created).toEqual(["Demo Vendor Echo 1"]);
        expect(second.created).toEqual(["Demo Vendor Echo 2"]);
        const fresh = manifest().fresh_invite;
        expect(fresh.internal_name).toBe("Demo Vendor Echo 2");
        expect(fresh.accept_url).toContain("#token=");
      });

      it("removes the demo vendors, locations, stock locations and identities on reset", async () => {
        await run();
        const container = getContainer();

        const summary = await run("--reset");

        expect(summary.removed.length).toBeGreaterThanOrEqual(5);
        const vendorModule = getVendorModule(container);
        expect(
          await vendorModule.listVendors({ internal_name: { $like: "Demo Vendor %" } }, { take: null })
        ).toHaveLength(0);
        expect(await vendorModule.listVendorLocations({}, { take: null })).toHaveLength(0);
        expect(await vendorModule.listVendorUsers({}, { take: null })).toHaveLength(0);
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as Query;
        const { data } = await query.graph({
          entity: "stock_location",
          fields: ["id", "name"],
        });
        expect(data.filter((row) => String(row.name).startsWith("LOC-"))).toHaveLength(0);
        expect(existsSync(path.join(outDir, "e2e", ".auth", "vendor-seed.json"))).toBe(false);
      });

      it("refuses to run when NODE_ENV is production", async () => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
          await expect(run()).rejects.toMatchObject({
            message: expect.stringContaining("production"),
          });
        } finally {
          process.env.NODE_ENV = previous;
        }
        expect(existsSync(path.join(outDir, "TEST-CREDENTIALS.local.md"))).toBe(false);
      });

      it("replaces only the marked section of the credentials file", async () => {
        const file = path.join(outDir, "TEST-CREDENTIALS.local.md");
        writeFileSync(
          file,
          `# My Notes\n\nKeep this line.\n\n${MARK_START}\nstale\n${MARK_END}\n\n## Tail\n\nKeep the tail.\n`
        );

        await run();
        await run();

        const text = readFileSync(file, "utf8");
        expect(text).toContain("Keep this line.");
        expect(text).toContain("Keep the tail.");
        expect(text).not.toContain("stale");
        expect(text.split(MARK_START)).toHaveLength(2);
        expect(text.split(MARK_END)).toHaveLength(2);
        expect(text).toContain("demo-vendor-alpha@example.test");
        expect(text).toContain("Demo-Alpha-Passw0rd-2026");
        expect(text).toContain("rerun with `--reset`");
      });

      it("creates the credentials file with a header when it is missing", async () => {
        await run();
        const text = readFileSync(path.join(outDir, "TEST-CREDENTIALS.local.md"), "utf8");
        expect(text.startsWith("# Test Credentials")).toBe(true);
        expect(text).toContain(MARK_START);
      });

      it("rejects an unknown argument", async () => {
        await expect(run("--bogus")).rejects.toMatchObject({
          message: expect.stringContaining("Usage"),
        });
      });

      describe("applyMarkedBlock", () => {
        it("appends a section to text that has none", () => {
          const result = applyMarkedBlock("# Title\n", "block");
          expect(result).toBe(`# Title\n\n${MARK_START}\nblock\n${MARK_END}\n`);
        });

        it("replaces an existing section and leaves the rest alone", () => {
          const result = applyMarkedBlock(`a\n${MARK_START}\nold\n${MARK_END}\nz\n`, "new");
          expect(result).toBe(`a\n${MARK_START}\nnew\n${MARK_END}\nz\n`);
        });
      });
    });
  },
});
