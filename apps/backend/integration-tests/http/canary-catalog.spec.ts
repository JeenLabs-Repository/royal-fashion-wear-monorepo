import { readFile } from "node:fs/promises";
import path from "node:path";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { VENDOR_MODULE } from "../../src/modules/vendor";
import { clearShipFromCache } from "../../src/lib/ship-from";
import { IMAGE_URL_PATTERN, type CatalogCanary, seedCatalogCanary, setCatalogCanary } from "../canary/catalog-canary";
import {
  CATALOG_CANARY,
  CATALOG_CANARY_TOKENS,
  CATALOG_SURFACE_IDS,
  DECLARATION_CANARY_VALUES,
} from "../canary/catalog-strings";
import { decodeAll, scanText, formatFinding } from "../canary/scan";
import { variantsOf } from "../canary/canary-strings";
import { collectStarterFields } from "../canary/starter-fields";
import type { Surface, SurfaceContext, SurfaceResponse } from "../canary/surfaces/registry";
import { adminHeadersFor } from "../helpers/admin-as";
import { createPublishableKey } from "../helpers/publishable-key";
import { probe } from "../helpers/staff-users";
import { createRegionsWorkflow } from "@medusajs/medusa/core-flows";
import { type ActiveVendor, createActiveVendor, createCategory } from "../support/catalog-fixtures";

jest.setTimeout(300_000);

// Only the resolver boundary is replaced, and only while a test sets a value.
// With no value the real resolver answers, which is the default-mode baseline.
const mockOverride: { value: unknown } = { value: undefined };
jest.mock("../../src/lib/settings/resolve-options", () => {
  const actual = jest.requireActual("../../src/lib/settings/resolve-options");
  return {
    ...actual,
    fetchResolvedOptions: (...args: unknown[]) =>
      mockOverride.value !== undefined ? Promise.resolve(mockOverride.value) : actual.fetchResolvedOptions(...args),
  };
});

const MARKETER_TEXT = "Canary Marketer Text Ltd";
const STOREFRONT_SRC = path.resolve(__dirname, "..", "..", "..", "storefront", "src");

const resolvedCard = (mode: string, text = "") => ({
  status: "resolved" as const,
  options: { lm_display_mode: mode, lm_marketer_text: text },
});

type Row = Record<string, any>;

// Walks any JSON value and returns the values stored under keys that match.
const valuesUnderKeys = (value: unknown, match: (key: string) => boolean, found: unknown[] = []): unknown[] => {
  if (Array.isArray(value)) {
    value.forEach((item) => valuesUnderKeys(item, match, found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Row)) {
      if (match(key)) found.push(child);
      valuesUnderKeys(child, match, found);
    }
  }
  return found;
};

const keyNames = (value: unknown, names = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) {
    value.forEach((item) => keyNames(item, names));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Row)) {
      names.add(key);
      keyNames(child, names);
    }
  }
  return names;
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let publishableKey: string;
    let regionId: string;
    let vendor: ActiveVendor;
    let canary: CatalogCanary;
    let context: SurfaceContext;
    let extraTokens: string[];
    let approverHeaders: Record<string, string>;

    const storeHeaders = () => ({ "x-publishable-api-key": publishableKey });
    const storeGet = (url: string) => api.get(url, { headers: storeHeaders(), validateStatus: () => true });

    // Vendor-side text that is not in the shared canary list: the vendor's own
    // names, contact data and location fields, read from the vendor module.
    // RESOLVE: method names follow the generated pattern for the vendor and
    // location models; confirm with `grep -n "listVendorLocations\|retrieveVendor" -r apps/backend/src/modules/vendor`.
    const vendorOnlyTokens = async (): Promise<string[]> => {
      const service = getContainer().resolve(VENDOR_MODULE) as any;
      const vendorRecord = await service.retrieveVendor(vendor.vendor_id);
      const locations = await service.listVendorLocations({ vendor_id: vendor.vendor_id });
      const tokens = new Set<string>([vendor.email]);
      for (const record of [vendorRecord, ...locations] as Row[]) {
        for (const [key, value] of Object.entries(record)) {
          if (typeof value !== "string" || /(^id$|_id$|_at$|^status$|^state(_code|_name)?$|^province$|^country(_code)?$)/.test(key)) continue;
          if (value.length >= 6 && !/^\d{4}-\d{2}-\d{2}T/.test(value)) tokens.add(value);
        }
      }
      const result = [...tokens];
      if (result.length < 4) {
        throw new Error(`Expected at least 4 vendor-only strings to scan for, found ${result.length}.`);
      }
      return result;
    };

    const leaksOf = (body: string, label: string): string[] => {
      const findings = scanText(body, label).map(formatFinding);
      const lower = body.toLowerCase();
      const decoded = decodeAll(body).toLowerCase();
      for (const token of extraTokens) {
        const hit =
          variantsOf(token).some((entry) => lower.includes(entry.value.toLowerCase())) ||
          decoded.includes(token.toLowerCase());
        if (hit) findings.push(`${label}: vendor-only string "${token}"`);
      }
      return findings;
    };

    const bodyOf = (response: SurfaceResponse): string =>
      typeof response.body === "string" ? response.body : response.body.toString("latin1");

    const surfaceById = (id: string): Surface => {
      // Loaded on demand so the registry is filled by the same module the crawl uses.
      const { listSurfaces } = require("../canary/surfaces");
      const surface = listSurfaces().find((entry: Surface) => entry.id === id);
      if (!surface) throw new Error(`Canary surface ${id} is not registered.`);
      return surface;
    };

    beforeEach(async () => {
      mockOverride.value = undefined;
      clearShipFromCache();
      const container = getContainer();
      publishableKey = await createPublishableKey(container);
      // Starter product fields include *variants.calculated_price, which needs a region.
      try {
        const {
          result: [region],
        } = await createRegionsWorkflow(container).run({
          input: {
            regions: [
              {
                name: `Canary catalog ${Date.now()}`,
                currency_code: "inr",
                countries: ["in"],
                payment_providers: ["pp_system_default"],
              },
            ],
          },
        });
        regionId = region.id;
      } catch {
        const listed = await api.get("/store/regions?limit=1&fields=id", {
          headers: { "x-publishable-api-key": publishableKey },
          validateStatus: () => true,
        });
        regionId = listed.data?.regions?.[0]?.id;
        if (!regionId) {
          throw new Error("Could not create or find a store region for the catalog canary.");
        }
      }
      approverHeaders = await adminHeadersFor(api, container, "catalog_approver");
      vendor = await createActiveVendor(api, container, {
        extraLocations: [{ state_code: "IN-KA", pin: "560001" }],
      });
      const categoryId = await createCategory(container);
      canary = await seedCatalogCanary({
        api: api as never,
        vendorHeaders: vendor.headers,
        approverHeaders,
        publishableKey,
        categoryId,
      });
      context = {
        backendUrl: String((api as any).defaults.baseURL),
        storefrontUrl: "http://storefront.invalid",
        locale: "en",
        manifest: { publishable_key: publishableKey, generated_at: new Date().toISOString(), vendors: {} },
        manifestPath: `in-process-${canary.productId}`,
      };
      setCatalogCanary(context, canary);
      extraTokens = await vendorOnlyTokens();
    });

    it("finds no vendor string on any Store API surface with the default display mode", async () => {
      const ids = CATALOG_SURFACE_IDS.filter((id) => id.startsWith("store."));
      expect(ids.length).toBe(6);
      for (const id of ids) {
        const surface = surfaceById(id);
        const responses = await surface.collect(context);
        expect(responses.length).toBeGreaterThanOrEqual(surface.minRequests);
        for (const response of responses) {
          expect(response.status).toBeLessThan(500);
          expect(leaksOf(bodyOf(response), `${id} ${response.url}`)).toEqual([]);
        }
      }
      // The three storefront-only groups are crawled by the live canary job and the browser spec.
      const storefrontIds = CATALOG_SURFACE_IDS.filter((id) => id.startsWith("storefront."));
      expect(storefrontIds.length).toBe(7);
      for (const id of storefrontIds) {
        expect(surfaceById(id).minRequests).toBeGreaterThanOrEqual(1);
      }
    });

    it("serves the image as WebP with no metadata under a key with no vendor-derived part", async () => {
      expect(canary.imageUrl).toMatch(IMAGE_URL_PATTERN);
      expect(canary.imageUrl.toLowerCase()).not.toContain(CATALOG_CANARY.image_stem);
      expect(canary.imageUrl).not.toContain(vendor.vendor_id);
      expect(canary.imageUrl).not.toContain(canary.productId);

      const key = new URL(canary.imageUrl, "http://files.invalid").pathname.replace(/^\/+/, "");
      let bytes: Buffer;
      try {
        // The local file provider keeps files in the static folder of the backend.
        bytes = await readFile(path.resolve(process.cwd(), "static", ...key.split("/").filter((part) => part !== "static")));
      } catch {
        bytes = Buffer.from(await (await fetch(canary.imageUrl)).arrayBuffer());
      }

      expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
      const text = bytes.toString("latin1").toLowerCase();
      for (const needle of ["exif", "gps", "canary", CATALOG_CANARY.camera_make.toLowerCase()]) {
        expect(text).not.toContain(needle);
      }
    });

    it("keeps vendor fields out of Store API responses, requests and searches", async () => {
      const entries = collectStarterFields(STOREFRONT_SRC).filter((entry) =>
        ["products.ts", "variants.ts"].includes(path.posix.basename(entry.file))
      );
      expect(entries.length).toBeGreaterThan(0);

      const urls = [
        `/store/products?limit=20&region_id=${regionId}`,
        `/store/products?limit=20&fields=id,handle,title&region_id=${regionId}`,
        `/store/products?handle=${canary.handle}&region_id=${regionId}`,
        ...entries.map(
          (entry) =>
            `/store/products?id=${canary.productId}&limit=1&region_id=${regionId}&fields=${encodeURIComponent(entry.fields)}`
        ),
      ];
      for (const url of urls) {
        const response = await storeGet(url);
        if (response.status !== 200) {
          throw new Error(`${url} answered ${response.status}: ${JSON.stringify(response.data).slice(0, 300)}`);
        }
        const raw = JSON.stringify(response.data);
        expect(leaksOf(raw, url)).toEqual([]);
        for (const name of keyNames(response.data)) {
          expect(name.toLowerCase()).not.toMatch(/vendor|payout|submission/);
        }
      }

      for (const needle of [CATALOG_CANARY.vendor_sku, CATALOG_CANARY.vendor_sku_second, extraTokens.find((token) => token !== vendor.email) as string]) {
        const found = await storeGet(`/store/products?q=${encodeURIComponent(needle)}&limit=20`);
        expect(found.status).toBe(200);
        expect(found.data.products).toEqual([]);
        expect(found.data.count).toBe(0);
      }

      // The field guard from the vendor-domain release still refuses a vendor field.
      const refused = await storeGet(`/store/products?fields=*vendor`);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.status).toBeLessThan(500);
    });

    it("keeps product, variant, option value and image metadata free of vendor strings", async () => {
      const fields = "*variants,*options,*options.values,*images,+metadata,+variants.metadata,+options.values.metadata,+images.metadata";
      const store = await storeGet(`/store/products?id=${canary.productId}&fields=${encodeURIComponent(fields)}`);
      expect(store.status).toBe(200);
      const admin = await probe(
        api as never,
        approverHeaders,
        "GET",
        `/admin/products/${canary.productId}?fields=${encodeURIComponent(fields)}`
      );
      expect(admin.status).toBe(200);

      for (const [label, data] of [["store", store.data], ["admin", admin.body]] as const) {
        const metadata = valuesUnderKeys(data, (key) => key === "metadata");
        expect(metadata.length).toBeGreaterThan(0);
        const raw = JSON.stringify(metadata);
        expect(leaksOf(raw, `${label} metadata`)).toEqual([]);
        for (const value of metadata) {
          expect(value === null || (typeof value === "object" && Object.keys(value as object).length === 0)).toBe(true);
        }
      }
    });

    it("follows the display mode through the real reader and route", async () => {
      const read = async () => {
        const response = await storeGet(`/store/product-declarations?product_ids=${canary.productId}`);
        expect(response.status).toBe(200);
        return response.data as { mode: string; declarations: { product_id: string; lines: { label: string; value: string }[] }[] };
      };
      const raw = (data: unknown) => JSON.stringify(data);

      // No card saved: the real resolver reports none and the default is hidden.
      const baseline = await read();
      expect(baseline).toEqual({ mode: "hidden", declarations: [] });
      for (const value of DECLARATION_CANARY_VALUES) expect(raw(baseline)).not.toContain(value);

      // Owner text: only the owner's line, none of the entered declaration.
      mockOverride.value = resolvedCard("owner_marketer", MARKETER_TEXT);
      const marketer = await read();
      expect(marketer.mode).toBe("owner_marketer");
      expect(marketer.declarations).toEqual([
        { product_id: canary.productId, lines: [{ label: "Marketed by", value: MARKETER_TEXT }] },
      ]);
      for (const value of DECLARATION_CANARY_VALUES) expect(raw(marketer)).not.toContain(value);

      // Entered declaration: the documented, accepted exposure, exactly as entered.
      mockOverride.value = resolvedCard("product_declared", MARKETER_TEXT);
      const declared = await read();
      expect(declared.mode).toBe("product_declared");
      const lines = Object.fromEntries(declared.declarations[0].lines.map((line) => [line.label, line.value]));
      expect(lines["Generic name"]).toBe(CATALOG_CANARY.generic_name);
      expect(lines["Packed by"]).toBe(CATALOG_CANARY.packed_by_name);
      expect(lines["Address"]).toBe(CATALOG_CANARY.packed_by_address);
      expect(typeof lines["Country of origin"]).toBe("string");
      expect(raw(declared)).not.toContain(MARKETER_TEXT);

      // An invalid mode fails closed.
      mockOverride.value = resolvedCard("everything", MARKETER_TEXT);
      expect(await read()).toEqual({ mode: "hidden", declarations: [] });

      // With the replacement removed the real resolver answers again.
      mockOverride.value = undefined;
      const restored = await read();
      expect(restored).toEqual({ mode: "hidden", declarations: [] });
      for (const value of DECLARATION_CANARY_VALUES) expect(raw(restored)).not.toContain(value);
    });

    it("fails the completeness check when one of the thirteen surfaces is dropped", () => {
      expect(CATALOG_SURFACE_IDS.length).toBe(13);
      expect(CATALOG_CANARY_TOKENS.length).toBe(8);

      // Register the thirteen ids without loading catalog collectors (those pull
      // helpers that re-register Medusa workflows under isolateModules).
      const fresh = () => {
        let registry: typeof import("../canary/surfaces/registry") | undefined;
        jest.isolateModules(() => {
          registry = require("../canary/surfaces/registry");
          for (const id of CATALOG_SURFACE_IDS) {
            registry!.registerSurface({
              id,
              kind: "store-api",
              owner: "catalog",
              description: id,
              minRequests: 1,
              collect: async () => [],
            });
          }
        });
        return registry as typeof import("../canary/surfaces/registry");
      };

      // Every id is registered, and marking all of them satisfies the check.
      const full = fresh();
      const registered = full.listSurfaces().map((surface) => surface.id).sort();
      expect(registered).toEqual([...CATALOG_SURFACE_IDS].sort());
      for (const id of registered) full.markExercised(id, 99);
      expect(() => full.assertAllExercised()).not.toThrow();

      // Dropping any one id from the crawl makes the check name it.
      for (const dropped of CATALOG_SURFACE_IDS) {
        const registry = fresh();
        for (const id of CATALOG_SURFACE_IDS) {
          if (id !== dropped) registry.markExercised(id, 99);
        }
        expect(() => registry.assertAllExercised()).toThrow(new RegExp(dropped.replace(/\./g, "\\.")));
      }
    });
  },
});
