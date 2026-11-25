import { assertHeader, decodeInSlices, scanCsv } from "../csv";
import { sanitizeCell, stripLeadingApostrophe, TEMPLATE_BODY } from "../csv-export";

// Records the size of every string the parser is asked to read.
const mockWriteSizes: number[] = [];

jest.mock("csv-parse", () => {
  const actual = jest.requireActual("csv-parse");
  return {
    ...actual,
    parse: (...args: unknown[]) => {
      const parser = actual.parse(...args);
      const write = parser.write.bind(parser);
      parser.write = (chunk: unknown, ...rest: unknown[]) => {
        mockWriteSizes.push(typeof chunk === "string" ? chunk.length : (chunk as Buffer).length);
        return write(chunk, ...rest);
      };
      return parser;
    },
  };
});

const HEADER = "vendor_sku,location_code,stocked_quantity";

const file = (rows: number): Buffer =>
  Buffer.from(
    `${HEADER}\n${Array.from({ length: rows }, (_, index) => `SKU-${index + 1},LOC-0001,${index % 100}`).join("\n")}\n`
  );

describe("assertHeader", () => {
  it("accepts the header with a byte order mark, spaces and capitals", async () => {
    expect(() => assertHeader(["vendor_sku", "location_code", "stocked_quantity"])).not.toThrow();
    expect(() => assertHeader([" Vendor_SKU ", "LOCATION_CODE", " Stocked_Quantity"])).not.toThrow();
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${HEADER}\nA-1,LOC-0001,4\n`)]);
    await expect(scanCsv(withBom)).resolves.toEqual({ rows: 1 });
    const spaced = Buffer.from(" VENDOR_SKU , location_code ,stocked_quantity\nA-1,LOC-0001,4\n");
    await expect(scanCsv(spaced)).resolves.toEqual({ rows: 1 });
  });

  it("rejects a missing, reordered or extra column with invalid_header", async () => {
    const codeOf = (run: () => void): string | undefined => {
      try {
        run();
      } catch (error) {
        return (error as { code?: string }).code;
      }
      return undefined;
    };
    expect(codeOf(() => assertHeader(["vendor_sku", "location_code"]))).toBe("invalid_header");
    expect(codeOf(() => assertHeader(["location_code", "vendor_sku", "stocked_quantity"]))).toBe("invalid_header");
    expect(codeOf(() => assertHeader(["vendor_sku", "location_code", "stocked_quantity", "note"]))).toBe(
      "invalid_header"
    );
    await expect(scanCsv(Buffer.from("A-1,LOC-0001,4\n"))).rejects.toMatchObject({ code: "invalid_header" });
    await expect(scanCsv(Buffer.from(`${HEADER},note\nA-1,LOC-0001,4,x\n`))).rejects.toMatchObject({
      code: "invalid_header",
    });
  });
});

describe("scanCsv", () => {
  it("reports 5,000 rows for a file at the cap", async () => {
    await expect(scanCsv(file(5000))).resolves.toEqual({ rows: 5000 });
  });

  it("refuses 5,001 rows with too_many_rows", async () => {
    await expect(scanCsv(file(5001))).rejects.toMatchObject({ code: "too_many_rows" });
  });

  it("refuses invalid UTF-8 with invalid_utf8", async () => {
    const bad = Buffer.concat([Buffer.from(`${HEADER}\nA-1,LOC-0001,4\n`), Buffer.from([0xff, 0xfe, 0x41])]);
    await expect(scanCsv(bad)).rejects.toMatchObject({ code: "invalid_utf8" });
  });

  it("refuses an unterminated quote with invalid_csv", async () => {
    await expect(scanCsv(Buffer.from(`${HEADER}\n"A-1,LOC-0001,4\n`))).rejects.toMatchObject({
      code: "invalid_csv",
    });
  });

  it("treats an empty buffer as file_required and a header-only buffer as zero rows", async () => {
    await expect(scanCsv(Buffer.alloc(0))).rejects.toMatchObject({ code: "file_required" });
    await expect(scanCsv(Buffer.from(`${HEADER}\n`))).resolves.toEqual({ rows: 0 });
  });

  it("hands the parser slices of at most 64 KB, never the whole text", async () => {
    mockWriteSizes.length = 0;
    await scanCsv(file(5000));
    expect(mockWriteSizes.length).toBeGreaterThan(1);
    expect(Math.max(...mockWriteSizes)).toBeLessThanOrEqual(64 * 1024);
  });

  it("decodes a character that straddles a slice boundary whole", () => {
    const text = `${"a".repeat(64 * 1024 - 1)}é${"b".repeat(10)}`;
    const pieces = Array.from(decodeInSlices(Buffer.from(text)));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join("")).toBe(text);
  });
});

describe("spreadsheet safety", () => {
  it("prefixes risky cells with an apostrophe and leaves plain values alone", () => {
    expect(sanitizeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeCell("+1")).toBe("'+1");
    expect(sanitizeCell("@cmd")).toBe("'@cmd");
    expect(sanitizeCell("\tx")).toBe("'\tx");
    expect(sanitizeCell("\rx")).toBe("'\rx");
    expect(sanitizeCell("-LEGACY1")).toBe("'-LEGACY1");
    expect(sanitizeCell("-5")).toBe("-5");
    expect(sanitizeCell("ABC-1")).toBe("ABC-1");
    expect(sanitizeCell("LOC-0001")).toBe("LOC-0001");
  });

  it("removes exactly one leading apostrophe on the way back in", () => {
    expect(stripLeadingApostrophe("'-LEGACY1")).toBe("-LEGACY1");
    expect(stripLeadingApostrophe("''-LEGACY1")).toBe("'-LEGACY1");
    expect(stripLeadingApostrophe("ABC-1")).toBe("ABC-1");
  });

  it("keeps the template at the header plus one example row", () => {
    expect(TEMPLATE_BODY).toBe(`${HEADER}\nEXAMPLE-SKU,LOC-0001,10\n`);
  });
});
