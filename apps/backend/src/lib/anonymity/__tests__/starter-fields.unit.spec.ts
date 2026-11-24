import { MedusaError } from "@medusajs/framework/utils";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { collectFieldTerms, findForbiddenTerm } from "../forbidden-fields";
import { storeAnonymityGuard } from "../store-guard";

// apps/backend/src/lib/anonymity/__tests__ -> five levels up is `apps`.
const STOREFRONT_SRC = path.resolve(__dirname, "../../../../..", "storefront", "src");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "node_modules" ? [] : walk(full);
    }
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });

// A `fields` key (`fields:`, `fields =`, `fields ??=`) followed, across lines if
// needed, by a quoted string. Template strings that interpolate are skipped.
const FIELDS_LITERAL = /\bfields\s*(?:\?\?=|=|:)\s*(["'`])((?:(?!\1)[^\\\n])*)\1/g;

const extractFieldStrings = (): { file: string; value: string }[] => {
  const found: { file: string; value: string }[] = [];
  for (const file of walk(STOREFRONT_SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(FIELDS_LITERAL)) {
      if (!match[2].includes("${")) {
        found.push({ file: path.relative(STOREFRONT_SRC, file), value: match[2] });
      }
    }
  }
  return found;
};

describe("the starter's own field strings", () => {
  const strings = extractFieldStrings();

  test("at least 15 strings are found, so the extraction cannot match nothing", () => {
    if (strings.length < 15) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(strings, null, 2));
    }
    expect(strings.length).toBeGreaterThanOrEqual(15);
  });

  test("the known starter strings are among them", () => {
    const values = strings.map((entry) => entry.value);
    expect(values).toContain("+metadata");
    expect(values.some((value) => value.includes("+variants.inventory_quantity"))).toBe(true);
  });

  // test.each rejects an empty table, so an empty extraction is reported by the
  // floor test above and the table is skipped.
  if (strings.length > 0) {
    test.each(strings.map((entry) => [entry.file, entry.value]))(
      "%s passes the guard: %s",
      (_file, value) => {
        const terms = collectFieldTerms(new URLSearchParams({ fields: value }));
        for (const raw of terms) {
          expect(findForbiddenTerm(raw)).toBeNull();
        }
      }
    );
  }
});

describe("storeAnonymityGuard", () => {
  const run = (url: string) => {
    const next = jest.fn();
    const warn = jest.fn();
    const req = {
      originalUrl: url,
      scope: { resolve: () => ({ warn }) },
    } as never;
    storeAnonymityGuard(req, {} as never, next);
    return { next, warn };
  };

  test.each([
    "/store/products?fields=vendor_id",
    "/store/products?fields=%2Bstock_location",
    "/store/products?expand=location_levels",
    "/store/products?include=reservations",
    "/store/products?fields[]=awb",
    `/store/products?fields=${"a,".repeat(2100)}`,
  ])("answers a forbidden term in %s with forbidden_field", (url) => {
    const { next } = run(url);
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as MedusaError;
    expect(error).toBeInstanceOf(MedusaError);
    expect(error.type).toBe(MedusaError.Types.INVALID_DATA);
    expect(error.code).toBe("forbidden_field");
    expect(error.message).toBe("A requested field is not available.");
  });

  test("does not echo the term in the error and logs it with the guard tag", () => {
    const { next, warn } = run("/store/products?fields=vendor_secret_column");
    expect((next.mock.calls[0][0] as Error).message).not.toContain("vendor_secret_column");
    expect(warn.mock.calls[0][0]).toContain("[store-guard]");
  });

  test.each([
    "/store/products",
    "/store/products?limit=5",
    "/store/products?fields=%2Bmetadata,*variants.calculated_price",
  ])("passes %s on without an error", (url) => {
    const { next } = run(url);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toHaveLength(0);
  });
});
