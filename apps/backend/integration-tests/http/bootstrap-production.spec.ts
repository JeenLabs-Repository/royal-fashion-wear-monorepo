import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import bootstrapProduction, {
  ensureProductionEssentials,
} from "../../src/scripts/bootstrap-production";

jest.setTimeout(120 * 1000);

const rows = async (container: MedusaContainer, entity: string, filters = {}) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity, fields: ["id"], filters });
  return data;
};

// Nothing a demo or a vendor flow creates may exist after the bootstrap.
const expectNoDemoData = async (container: MedusaContainer) => {
  for (const entity of ["product", "product_category", "user", "stock_location"]) {
    expect(await rows(container, entity)).toHaveLength(0);
  }
};

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("first-deploy bootstrap", () => {
      test("refuses to run outside production without the explicit flag", async () => {
        // The test runner runs with NODE_ENV set to test. createDefaults may
        // already hold a publishable key from boot, so only assert the refuse
        // did not create a region or an extra key.
        const container = getContainer();
        const keysBefore = await rows(container, "api_key", { type: "publishable" });

        await expect(
          bootstrapProduction({ container, args: [] } as never),
        ).rejects.toThrow(/Refusing to run/);

        expect(await rows(container, "region")).toHaveLength(0);
        expect(await rows(container, "api_key", { type: "publishable" })).toHaveLength(
          keysBefore.length,
        );
      });

      test("creates only the essentials on an empty database", async () => {
        const container = getContainer();
        const query = container.resolve(ContainerRegistrationKeys.QUERY);

        const result = await ensureProductionEssentials(container);
        expect(result.created.length).toBeGreaterThan(0);
        expect(result.publishableKey.token).toMatch(/^pk_/);

        const { data: regions } = await query.graph({
          entity: "region",
          fields: ["id", "name", "currency_code", "countries.iso_2"],
        });
        expect(regions).toHaveLength(1);
        expect(regions[0]).toMatchObject({ name: "India", currency_code: "inr" });
        expect(regions[0].countries?.map((country) => country?.iso_2)).toEqual(["in"]);

        const pricing = container.resolve(Modules.PRICING);
        const preferences = await pricing.listPricePreferences({
          attribute: "region_id",
          value: regions[0].id,
        });
        expect(preferences).toHaveLength(1);
        expect(preferences[0].is_tax_inclusive).toBe(true);

        const { data: stores } = await query.graph({
          entity: "store",
          fields: ["id", "default_sales_channel_id", "supported_currencies.currency_code", "supported_currencies.is_default"],
        });
        expect(stores).toHaveLength(1);
        expect(stores[0].supported_currencies).toEqual([
          expect.objectContaining({ currency_code: "inr", is_default: true }),
        ]);

        const { data: keys } = await query.graph({
          entity: "api_key",
          fields: ["id", "token", "type", "sales_channels.id"],
          filters: { type: "publishable" },
        });
        expect(keys).toHaveLength(1);
        expect(keys[0].sales_channels?.map((channel) => channel?.id)).toContain(
          stores[0].default_sales_channel_id,
        );

        await expectNoDemoData(container);
      });

      test("changes nothing on a second run", async () => {
        const container = getContainer();
        const first = await ensureProductionEssentials(container);
        const regionsBefore = await rows(container, "region");
        const keysBefore = await rows(container, "api_key", { type: "publishable" });

        const second = await ensureProductionEssentials(container);

        expect(second.created).toEqual([]);
        expect(second.present.length).toBe(first.created.length + first.present.length);
        expect(second.publishableKey).toEqual(first.publishableKey);
        expect(await rows(container, "region")).toHaveLength(regionsBefore.length);
        expect(await rows(container, "api_key", { type: "publishable" })).toHaveLength(keysBefore.length);
        await expectNoDemoData(container);
      });

      test("runs outside production when the explicit flag is passed", async () => {
        await expect(
          bootstrapProduction({
            container: getContainer(),
            args: ["--allow-non-production"],
          } as never),
        ).resolves.not.toThrow();
        expect(await rows(getContainer(), "region")).toHaveLength(1);
      });
    });
  },
});
