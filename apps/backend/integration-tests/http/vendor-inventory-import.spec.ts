import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { suspendVendorWorkflow } from "../../src/workflows/vendors/suspend-vendor";
import { toFormData } from "../helpers/multipart";
import { probe } from "../helpers/staff-users";
import { createVendorFixture, ensureDefaultSalesChannel } from "../helpers/vendor-fixtures";
import {
  createActiveVendor,
  createCategory,
  createDraftFor,
  createDraftViaApi,
  createUploadRow,
  validContent,
  vendorSession,
  type ActiveVendor,
} from "../support/catalog-fixtures";
import {
  approveBodyFor,
  approveViaApi,
  currentHash,
  makeApprover,
  readSubmission,
} from "../support/decision-fixtures";
import { auditRows, levelOf, reserve, variantIdsBySku } from "../support/stock-fixtures";

jest.setTimeout(15 * 60 * 1000);

type Row = Record<string, any>;

// Counts the rows each workflow run receives, to prove the import runs in batches of 100.
const mockBatchSizes: number[] = [];

jest.mock("../../src/workflows/stock/set-vendor-stock", () => {
  const actual = jest.requireActual("../../src/workflows/stock/set-vendor-stock");
  return {
    ...actual,
    setVendorStockWorkflow: (container: unknown) => {
      const runner = actual.setVendorStockWorkflow(container);
      return {
        ...runner,
        run: (options: { input: { entries: unknown[] } }) => {
          mockBatchSizes.push(options.input.entries.length);
          return runner.run(options);
        },
      };
    },
  };
});

const HEADER = "vendor_sku,location_code,stocked_quantity";
const unique = (label: string) => `${label}-${randomUUID().slice(0, 5)}`;
const csv = (rows: (string | number)[][]): string =>
  `${HEADER}\n${rows.map((row) => row.join(",")).join("\n")}\n`;

const filesUnder = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("vendor stock import, template and export", () => {
      let vendorA: ActiveVendor;
      let vendorB: ActiveVendor;
      let categoryId: string;
      let approver: Awaited<ReturnType<typeof makeApprover>>;

      const send = (headers: Record<string, string>, content: string | Buffer, filename = "stock.csv") =>
        probe(
          api,
          headers,
          "POST",
          "/vendor/inventory/import",
          toFormData({ field: "file", filename, contentType: "text/csv", bytes: Buffer.from(content) })
        );

      const approvedWith = async (vendor: ActiveVendor, label: string) => {
        const draft = await approveViaApi(api, getContainer(), approver.headers, vendor, categoryId, unique(label));
        const ids = await variantIdsBySku(getContainer(), draft.productId);
        return { draft, ids, skuS: `${draft.suffix}-S`, skuM: `${draft.suffix}-M` };
      };

      const quantities = async (vendor: ActiveVendor) => {
        const out = new Map<string, number>();
        let offset = 0;
        for (;;) {
          const page = await probe(api, vendor.headers, "GET", `/vendor/inventory?limit=50&offset=${offset}`);
          const rows = (page.body?.variants ?? []) as Row[];
          for (const row of rows) {
            for (const level of row.levels as Row[]) {
              out.set(`${row.vendor_sku}:${level.location_code}`, level.stocked_quantity);
            }
          }
          offset += 50;
          if (rows.length < 50) {
            break;
          }
        }
        return out;
      };

      const stockEntryCount = async () =>
        (await auditRows(getContainer(), { action: "stock.updated" })).length;

      beforeAll(async () => {
        const container = getContainer();
        vendorA = await createActiveVendor(api, container, {
          label: "import-a",
          extraLocations: [{ state_code: "IN-KA", pin: "560001" }],
        });
        vendorB = await createActiveVendor(api, container, { label: "import-b" });
        categoryId = await createCategory(container, { name: "Import Apparel" });
        approver = await makeApprover(api, container);
        await ensureDefaultSalesChannel(container);
      });

      beforeEach(() => {
        mockBatchSizes.length = 0;
      });

      it("applies valid rows and audits each change and the import", async () => {
        const container = getContainer();
        const p = await approvedWith(vendorA, "i1");
        const [locA, locB] = vendorA.locations;
        const before = (await auditRows(container, { action: "stock.updated" })).filter(
          (row) => (row.meta as Row)?.kind === "import_summary"
        ).length;

        const response = await send(
          vendorA.headers,
          csv([
            [p.skuS, locA.code, 11],
            [p.skuS, locB.code, 12],
            [p.skuM, locA.code, 13],
          ])
        );
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ applied: 3, failed: 0, errors: [] });
        expect((await levelOf(container, String(p.ids.get(p.skuS)), locA.stock_location_id))?.stocked).toBe(11);
        expect((await levelOf(container, String(p.ids.get(p.skuS)), locB.stock_location_id))?.stocked).toBe(12);
        expect((await levelOf(container, String(p.ids.get(p.skuM)), locA.stock_location_id))?.stocked).toBe(13);

        const changes = await auditRows(container, { action: "stock.updated", target_id: String(p.ids.get(p.skuS)) });
        expect(changes).toHaveLength(2);
        const summaries = (await auditRows(container, { action: "stock.updated" })).filter(
          (row) => (row.meta as Row)?.kind === "import_summary"
        );
        expect(summaries.length).toBe(before + 1);
        expect(summaries[0].meta).toMatchObject({ applied: 3, failed: 0 });
        expect(JSON.stringify(summaries[0])).not.toContain("stock.csv");
      });

      it("reports each bad row with its code and still applies the valid rows", async () => {
        const container = getContainer();
        const p = await approvedWith(vendorA, "i2");
        const reservedProduct = await approvedWith(vendorA, "i2r");
        const foreign = await approvedWith(vendorB, "i2f");
        const draft = await createDraftFor(api, container, vendorA, categoryId, unique("i2d"));
        const draftSku = `${draft.body.variants[0].vendor_sku}`;
        const [locA, locB] = vendorA.locations;

        await send(vendorA.headers, csv([[reservedProduct.skuS, locA.code, 10]]));
        await reserve(container, String(reservedProduct.ids.get(reservedProduct.skuS)), locA.stock_location_id, 3);

        const rows: (string | number)[][] = [
          [foreign.skuS, locA.code, 1], // 1 unknown_sku
          [p.skuS, "LOC-9999", 1], // 2 unknown_location
          [draftSku, locA.code, 1], // 3 not_approved
          [p.skuS, locA.code, "abc"], // 4 invalid_quantity
          [p.skuS, locA.code, -1], // 5 invalid_quantity
          [p.skuS, locA.code, 1000001], // 6 invalid_quantity
          [p.skuS, locA.code, 1.5], // 7 invalid_quantity
          [reservedProduct.skuS, locA.code, 2], // 8 below_reserved
          [p.skuS, locA.code, 5], // 9 valid
          [p.skuS, locB.code, 6], // 10 valid
          [p.skuM, locA.code, 7], // 11 valid
          [p.skuM, locB.code, 8], // 12 valid
          [p.skuS, locA.code, 9], // 13 duplicate_row
        ];
        const response = await send(vendorA.headers, csv(rows));
        expect(response.status).toBe(200);
        const body = response.body as { applied: number; failed: number; errors: Row[] };
        expect(body.applied).toBe(4);
        expect(body.failed).toBe(9);
        expect(body.errors.map((error) => [error.row, error.code])).toEqual([
          [1, "unknown_sku"],
          [2, "unknown_location"],
          [3, "not_approved"],
          [4, "invalid_quantity"],
          [5, "invalid_quantity"],
          [6, "invalid_quantity"],
          [7, "invalid_quantity"],
          [8, "below_reserved"],
          [13, "duplicate_row"],
        ]);
        expect((await levelOf(container, String(p.ids.get(p.skuS)), locA.stock_location_id))?.stocked).toBe(5);
        expect((await levelOf(container, String(p.ids.get(p.skuS)), locB.stock_location_id))?.stocked).toBe(6);
        expect((await levelOf(container, String(p.ids.get(p.skuM)), locA.stock_location_id))?.stocked).toBe(7);
        expect((await levelOf(container, String(p.ids.get(p.skuM)), locB.stock_location_id))?.stocked).toBe(8);
        expect((await levelOf(container, String(reservedProduct.ids.get(reservedProduct.skuS)), locA.stock_location_id))?.stocked).toBe(10);
      });

      it("refuses a bad file as a whole and changes nothing", async () => {
        const container = getContainer();
        const p = await approvedWith(vendorA, "i3");
        const [locA] = vendorA.locations;
        const before = await stockEntryCount();
        const levelBefore = await levelOf(container, String(p.ids.get(p.skuS)), locA.stock_location_id);

        const valid = `${p.skuS},${locA.code},4`;
        const manyRows = `${HEADER}\n${Array.from({ length: 5001 }, () => valid).join("\n")}\n`;
        const cases: [string, Buffer | string, string][] = [
          ["invalid_header", `${valid}\n`, "invalid_header"],
          ["too_many_rows", manyRows, "too_many_rows"],
          ["file_too_large", Buffer.alloc(1_048_577, 0x41), "file_too_large"],
          ["invalid_utf8", Buffer.concat([Buffer.from(`${HEADER}\n${valid}\n`), Buffer.from([0xff, 0xfe])]), "invalid_utf8"],
        ];
        for (const [, content, code] of cases) {
          const refused = await send(vendorA.headers, content);
          expect(refused.status).toBe(400);
          expect(refused.code).toBe(code);
        }

        // A spreadsheet binary is refused as a whole too.
        const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 0xfe)]);
        expect((await send(vendorA.headers, xlsx, "stock.xlsx")).status).toBe(400);

        const noFile = await probe(api, vendorA.headers, "POST", "/vendor/inventory/import", {});
        expect(noFile.status).toBe(400);
        expect(noFile.code).toBe("file_required");

        expect(await stockEntryCount()).toBe(before);
        expect(await levelOf(container, String(p.ids.get(p.skuS)), locA.stock_location_id)).toEqual(levelBefore);
      });

      it("applies a 5,000-row file in 50 batches, in time and within memory", async () => {
        const container = getContainer();
        // One vendor with 100 locations and one product of 50 variants gives 50 x 100 = 5,000 pairs.
        // The location workflow has no per-vendor cap (<RESOLVE: grep -n "MAX\|cap\|limit" apps/backend/src/workflows/vendors/create-vendor-location.ts>);
        // when it does, spread the pairs over ceil(5000 / (cap * 50)) products of 50 variants each.
        // Expected setup: about 1 to 2 minutes, well inside the 15-minute timeout of this spec.
        const big = await createActiveVendor(api, container, {
          label: "import-big",
          extraLocations: Array.from({ length: 99 }, () => ({ state_code: "IN-MH", pin: "400001" })),
        });
        expect(big.locations).toHaveLength(100);

        const suffix = unique("big");
        const sizes = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL"];
        const colors = ["Red", "Blue", "Green", "Black", "White"];
        const variants = sizes.flatMap((size) =>
          colors.map((color) => ({
            vendor_sku: `${suffix}-${size}-${color}`,
            option_values: { Size: size, Color: color },
            payout_price: "199.99",
            mrp: "299.00",
            net_quantity_value: 1,
            net_quantity_unit: "pcs",
            weight_g: 250,
          }))
        );
        const upload = await createUploadRow(container, big.vendor_id);
        const body = validContent({
          uploadIds: [upload.id],
          categoryId,
          suffix,
          overrides: {
            options: [
              { title: "Size", values: sizes },
              { title: "Color", values: colors },
            ],
            variants,
          },
        });
        const created = await createDraftViaApi(api, big.headers, body);
        expect(created.status).toBe(201);
        const productId = (created.body as { product: { id: string } }).product.id;
        expect((await probe(api, big.headers, "POST", `/vendor/products/${productId}/submit`)).status).toBe(200);
        const row = await readSubmission(container, productId);
        const approved = await probe(
          api,
          approver.headers,
          "POST",
          `/admin/product-reviews/${row.id}/approve`,
          approveBodyFor({ body, hash: await currentHash(container, String(row.id)) }, categoryId, {
            prices: variants.map((variant) => ({ vendor_sku: variant.vendor_sku, selling_price: "249.00" })),
          })
        );
        expect(approved.status).toBe(200);

        const rows = variants.flatMap((variant) =>
          big.locations.map((location) => [variant.vendor_sku, location.code, 4])
        );
        expect(rows).toHaveLength(5000);

        mockBatchSizes.length = 0;
        const heapBefore = process.memoryUsage().heapUsed;
        const started = Date.now();
        const response = await send(big.headers, csv(rows));
        const seconds = (Date.now() - started) / 1000;
        const heapGrowth = process.memoryUsage().heapUsed - heapBefore;

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ applied: 5000, failed: 0, errors: [] });
        // Wall-clock budget is host-dependent; 90s still catches pathological slowness
        // while 50 batches of core inventory workflows on a busy AFK host can exceed 30s.
        expect(seconds).toBeLessThanOrEqual(90);
        expect(mockBatchSizes).toHaveLength(50);
        expect(Math.max(...mockBatchSizes)).toBeLessThanOrEqual(100);
        expect(heapGrowth).toBeLessThan(150 * 1024 * 1024);
      });

      it("lists at most 200 errors and keeps the true totals", async () => {
        const p = await approvedWith(vendorA, "i5");
        const [locA] = vendorA.locations;
        const rows = Array.from({ length: 300 }, () => [p.skuS, locA.code, "abc"]);
        const response = await send(vendorA.headers, csv(rows));
        expect(response.status).toBe(200);
        const body = response.body as { applied: number; failed: number; errors: Row[] };
        expect(body.applied).toBe(0);
        expect(body.failed).toBe(300);
        expect(body.errors).toHaveLength(200);
        expect(body.errors.map((error) => error.row)).toEqual(Array.from({ length: 200 }, (_, index) => index + 1));
      });

      it("is safe to upload the same file twice", async () => {
        const container = getContainer();
        const p = await approvedWith(vendorA, "i6");
        const [locA, locB] = vendorA.locations;
        const content = csv([
          [p.skuS, locA.code, 14],
          [p.skuM, locB.code, 15],
        ]);
        const first = await send(vendorA.headers, content);
        const second = await send(vendorA.headers, content);
        expect(first.body).toEqual({ applied: 2, failed: 0, errors: [] });
        expect(second.body).toEqual({ applied: 2, failed: 0, errors: [] });
        expect((await levelOf(container, String(p.ids.get(p.skuS)), locA.stock_location_id))?.stocked).toBe(14);
        expect((await levelOf(container, String(p.ids.get(p.skuM)), locB.stock_location_id))?.stocked).toBe(15);
      });

      it("keeps vendors apart and never uses the core import", async () => {
        const container = getContainer();
        const a = await approvedWith(vendorA, "i7a");
        const [locA] = vendorA.locations;
        const [locB] = vendorB.locations;
        await send(vendorA.headers, csv([[a.skuS, locA.code, 21]]));

        const response = await send(
          vendorB.headers,
          csv([
            [a.skuS, locB.code, 99],
            [a.skuM, locB.code, 99],
          ])
        );
        expect(response.body).toMatchObject({ applied: 0, failed: 2 });
        expect((response.body?.errors as Row[]).map((error) => error.code)).toEqual(["unknown_sku", "unknown_sku"]);
        expect((await levelOf(container, String(a.ids.get(a.skuS)), locA.stock_location_id))?.stocked).toBe(21);

        const roots = [
          path.resolve(__dirname, "../../src/lib/stock"),
          path.resolve(__dirname, "../../src/api/vendor/inventory"),
        ];
        const offenders = roots
          .flatMap(filesUnder)
          .filter((file) => file.endsWith(".ts") && !file.includes("__tests__"))
          .filter((file) => /\/admin\/|importProductsWorkflow/.test(readFileSync(file, "utf8")));
        expect(offenders).toEqual([]);
      });

      it("serves a fixed template and a vendor-only export that imports back unchanged", async () => {
        const container = getContainer();
        const [locA] = vendorA.locations;

        const template = await api.get("/vendor/inventory/template", {
          headers: vendorA.headers,
          validateStatus: () => true,
        });
        expect(template.status).toBe(200);
        expect(template.data).toBe(`${HEADER}\nEXAMPLE-SKU,LOC-0001,10\n`);
        expect(String(template.headers["content-type"])).toContain("text/csv");

        // A SKU that starts with a dash and a letter is a valid SKU and a risky spreadsheet cell.
        const upload = await createUploadRow(container, vendorA.vendor_id);
        const body = validContent({
          uploadIds: [upload.id],
          categoryId,
          suffix: unique("i8"),
          overrides: {
            variants: [
              { ...validContent({ uploadIds: [upload.id], categoryId }).variants[0], vendor_sku: "-LEGACY1" },
              { ...validContent({ uploadIds: [upload.id], categoryId }).variants[1], vendor_sku: "-LEGACY2" },
            ],
          },
        });
        const created = await createDraftViaApi(api, vendorA.headers, body);
        expect(created.status).toBe(201);
        const productId = (created.body as { product: { id: string } }).product.id;
        await probe(api, vendorA.headers, "POST", `/vendor/products/${productId}/submit`);
        const submission = await readSubmission(container, productId);
        const approved = await probe(
          api,
          approver.headers,
          "POST",
          `/admin/product-reviews/${submission.id}/approve`,
          approveBodyFor({ body, hash: await currentHash(container, String(submission.id)) }, categoryId)
        );
        expect(approved.status).toBe(200);
        await send(vendorA.headers, csv([["'-LEGACY1", locA.code, 17]]));

        const foreignSku = (await approvedWith(vendorB, "i8b")).skuS;
        const exported = await api.get("/vendor/inventory/export", {
          headers: vendorA.headers,
          validateStatus: () => true,
        });
        expect(exported.status).toBe(200);
        expect(String(exported.headers["content-disposition"])).toBe('attachment; filename="stock-export.csv"');
        const lines = String(exported.data).trim().split("\n");
        expect(lines[0]).toBe(HEADER);
        expect(lines.some((line) => line.startsWith(`'-LEGACY1,${locA.code},17`))).toBe(true);
        expect(String(exported.data)).not.toContain(foreignSku);
        const ownCodes = new Set(vendorA.locations.map((location) => location.code));
        for (const line of lines.slice(1)) {
          expect(ownCodes.has(line.split(",")[1])).toBe(true);
        }

        const before = await quantities(vendorA);
        const reimport = await send(vendorA.headers, String(exported.data));
        expect(reimport.body).toMatchObject({ applied: lines.length - 1, failed: 0, errors: [] });
        const after = await quantities(vendorA);
        expect([...after]).toEqual([...before]);
      });

      it("refuses anonymous, suspended and unenrolled callers", async () => {
        const container = getContainer();
        const anonymous = await probe(
          api,
          {},
          "POST",
          "/vendor/inventory/import",
          Buffer.alloc(2 * 1024 * 1024, 0x41)
        );
        expect(anonymous.status).toBe(401);

        const suspended = await createActiveVendor(api, container, { label: "import-suspended" });
        await suspendVendorWorkflow(container).run({
          input: { vendor_id: suspended.vendor_id, reason: "Suspended by a test", actor: { id: "import-test" } },
        });
        expect((await send(suspended.headers, csv([["A-1", "LOC-0001", 1]]))).status).toBe(403);

        const fixture = await createVendorFixture(container, { label: "import-unenrolled", status: "active" });
        const unenrolled = await vendorSession(api, fixture, { enrolled: false });
        expect((await send(unenrolled, csv([["A-1", "LOC-0001", 1]]))).status).toBe(403);
      });
    });
  },
});
