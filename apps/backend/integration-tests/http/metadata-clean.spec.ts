import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { updateProductsWorkflow, createProductsWorkflow } from "@medusajs/medusa/core-flows";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { CANARY_VENDORS } from "../canary/canary-strings";
import { scanText } from "../canary/scan";
import { ensureDefaultSalesChannel } from "../helpers/vendor-fixtures";
import { seedCanary } from "../../src/scripts/lib/canary-seed";

jest.setTimeout(180_000);

// Graph entry names from the installed modules (product_variant is an alias on Product).
const ENTITIES = [
  "product",
  "product_variant",
  "cart",
  "order",
  "customer",
  "customer_address",
  "stock_location",
  "sales_channel",
];

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    const readAll = async (entity: string, fields: string[] = ["*"]) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({ entity, fields, pagination: { take: 1000, skip: 0 } });
      return data;
    };

    const scanEverything = async (): Promise<string[]> => {
      const leaks: string[] = [];
      for (const entity of ENTITIES) {
        const rows = await readAll(entity, entity === "stock_location" ? ["*", "address.*"] : ["*"]);
        for (const finding of scanText(JSON.stringify(rows), entity)) {
          leaks.push(`${entity}: ${finding.token} (${finding.variant})`);
        }
      }
      return leaks;
    };

    describe("vendor strings stay out of core data", () => {
      beforeAll(async () => {
        const container = getContainer();
        // The throwaway HTTP database has no store yet; the canary seed links
        // the publishable key and channel rules to the store default.
        await ensureDefaultSalesChannel(container);
        const outDir = mkdtempSync(path.join(os.tmpdir(), "canary-metadata-"));
        await seedCanary(container, { outDir });
      });

      it("keeps every canary string out of products, carts, orders, customers, stock locations and channels", async () => {
        expect(await scanEverything()).toEqual([]);
      });

      it("names every stock location with an opaque code and only a country and province", async () => {
        const locations = await readAll("stock_location", ["*", "address.*"]);
        expect(locations.length).toBeGreaterThanOrEqual(Object.keys(CANARY_VENDORS).length);
        for (const location of locations) {
          expect(location.name).toMatch(/^LOC-[0-9]{4,}$/);
          const address = location.address ?? {};
          expect(String(address.country_code ?? "").toLowerCase()).toBe("in");
          expect(address.address_2 ?? "").toBe("");
          expect(address.city ?? "").toBe("");
        }
      });

      it("detects a canary planted in product metadata and passes again once it is removed", async () => {
        const container = getContainer();
        // Medusa 2.22.7 requires at least one option on createProductsWorkflow.
        const { result: created } = await createProductsWorkflow(container).run({
          input: {
            products: [
              {
                title: "Metadata check product",
                status: "draft",
                options: [{ title: "Default", values: ["Default"] }],
                variants: [
                  {
                    title: "Default",
                    options: { Default: "Default" },
                  },
                ],
              },
            ],
          },
        });
        const productId = created[0].id;

        try {
          await updateProductsWorkflow(container).run({
            input: {
              selector: { id: productId },
              update: { metadata: { supplier: CANARY_VENDORS.alpha.internal_name } },
            },
          });
          const leaks = await scanEverything();
          expect(leaks.some((leak) => leak.startsWith("product:"))).toBe(true);
        } finally {
          await updateProductsWorkflow(container).run({
            input: { selector: { id: productId }, update: { metadata: { supplier: null } } },
          });
        }

        expect(await scanEverything()).toEqual([]);
      });

      it("writes the manifest the crawl reads", async () => {
        const { manifest } = await seedCanary(getContainer(), {
          outDir: mkdtempSync(path.join(os.tmpdir(), "canary-manifest-")),
        });
        expect(manifest.publishable_key).toMatch(/^pk_/);
        expect(Object.keys(manifest.vendors).sort()).toEqual(["alpha", "beta", "gamma"]);
      });
    });
  },
});
