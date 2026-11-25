import {
  buildDirectory,
  normalizeStateName,
  parseCsv,
  stripOfficeSuffix,
  titleCase,
  type CsvRow,
} from "../pincode-build";
import { STATES } from "../states";

const codeOf = (name: string): string => STATES.find((s) => s.name === name)?.code as string;

const row = (overrides: Partial<CsvRow> = {}): CsvRow => ({
  pincode: "400001",
  officename: "Mumbai G.P.O. S.O",
  officetype: "SO",
  district: "MUMBAI",
  statename: "MAHARASHTRA",
  ...overrides,
});

describe("parseCsv", () => {
  it("keys rows by lower-case header names", () => {
    expect(parseCsv("PinCode,StateName\n400001,MAHARASHTRA\n")).toEqual([
      { pincode: "400001", statename: "MAHARASHTRA" },
    ]);
  });

  it("reads quoted fields with commas and doubled quotes", () => {
    const rows = parseCsv("a,b\n\"x, y\",\"say \"\"hi\"\"\"\n");
    expect(rows).toEqual([{ a: "x, y", b: "say \"hi\"" }]);
  });

  it("handles CRLF, LF and a missing trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
    expect(parseCsv("a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });

  it("returns no rows for an empty file and ignores blank lines", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a\n\n1\n")).toEqual([{ a: "1" }]);
  });
});

describe("normalizeStateName", () => {
  it.each([
    ["ORISSA", "IN-OD"],
    ["Odisha", "IN-OD"],
    ["UTTARANCHAL", "IN-UT"],
    ["UTTARAKHAND", "IN-UT"],
    ["PONDICHERRY", "IN-PY"],
    ["Puducherry", "IN-PY"],
    ["NCT OF DELHI", "IN-DL"],
    ["DELHI", "IN-DL"],
    ["DADRA & NAGAR HAVELI", "IN-DH"],
    ["DAMAN & DIU", "IN-DH"],
    ["DADRA AND NAGAR HAVELI AND DAMAN AND DIU", "IN-DH"],
    ["JAMMU & KASHMIR", "IN-JK"],
    ["LADAKH", "IN-LA"],
    ["TELANGANA", codeOf("Telangana")],
    ["CHHATTISGARH", codeOf("Chhattisgarh")],
    ["CHATTISGARH", codeOf("Chhattisgarh")],
    ["  tamil   nadu ", "IN-TN"],
    ["ANDAMAN & NICOBAR ISLANDS", "IN-AN"],
  ])("maps %s to %s", (name, code) => {
    expect(normalizeStateName(name)).toBe(code);
  });

  it("maps every table name to its own code", () => {
    for (const state of STATES) {
      expect(normalizeStateName(state.name)).toBe(state.code);
    }
  });

  it("throws and names an unknown state", () => {
    expect(() => normalizeStateName("ATLANTIS")).toThrow(/ATLANTIS/);
  });
});

describe("office names", () => {
  it.each([
    ["Abc B.O", "Abc"],
    ["Abc S.O", "Abc"],
    ["Abc H.O", "Abc"],
    ["Abc BO", "Abc"],
    ["Abc SO", "Abc"],
    ["Abc HO", "Abc"],
    ["Boston Road", "Boston Road"],
  ])("strips the suffix of %s", (name, expected) => {
    expect(stripOfficeSuffix(name)).toBe(expected);
  });

  it("title-cases words, hyphens and slashes", () => {
    expect(titleCase("NEW DELHI-SOUTH/EAST")).toBe("New Delhi-South/East");
  });
});

describe("buildDirectory", () => {
  it("builds one entry per valid PIN with state, district and offices", () => {
    const { directory } = buildDirectory([row()], "2026-01-01");
    expect(directory.pins["400001"]).toEqual(["IN-MH", "Mumbai", ["Mumbai G.P.O."]]);
    expect(directory.count).toBe(1);
  });

  it("skips and counts rows with a malformed PIN", () => {
    const result = buildDirectory(
      [row(), row({ pincode: "012345" }), row({ pincode: "40001" }), row({ pincode: "abcdef" })],
      "2026-01-01"
    );
    expect(result.rows_read).toBe(4);
    expect(result.rows_skipped).toBe(3);
    expect(result.directory.count).toBe(1);
  });

  it("keeps the majority state when a PIN appears under two states and counts the conflict", () => {
    const result = buildDirectory(
      [
        row({ pincode: "123456", statename: "HARYANA", officename: "A B.O", officetype: "BO" }),
        row({ pincode: "123456", statename: "HARYANA", officename: "B B.O", officetype: "BO" }),
        row({ pincode: "123456", statename: "PUNJAB", officename: "C B.O", officetype: "BO" }),
      ],
      "2026-01-01"
    );
    expect(result.directory.pins["123456"][0]).toBe("IN-HR");
    expect(result.conflicts).toBe(1);
  });

  it("orders offices head, sub, branch then alphabetical and keeps five at most", () => {
    const rows = [
      row({ officename: "Zed B.O", officetype: "BO" }),
      row({ officename: "Alpha B.O", officetype: "BO" }),
      row({ officename: "Sub One S.O", officetype: "SO" }),
      row({ officename: "Main H.O", officetype: "HO" }),
      row({ officename: "Sub Two S.O", officetype: "SO" }),
      row({ officename: "Beta B.O", officetype: "BO" }),
      row({ officename: "Gamma B.O", officetype: "BO" }),
    ];
    const offices = buildDirectory(rows, "2026-01-01").directory.pins["400001"][2];
    expect(offices).toEqual(["Main", "Sub One", "Sub Two", "Alpha", "Beta"]);
  });

  it("keeps distinct names only", () => {
    const rows = [row({ officename: "Dup B.O" }), row({ officename: "dup S.O" })];
    expect(buildDirectory(rows, "2026-01-01").directory.pins["400001"][2]).toHaveLength(1);
  });

  it("derives the office rank from the suffix when the type column is empty", () => {
    const rows = [
      row({ officename: "Later B.O", officetype: "" }),
      row({ officename: "First H.O", officetype: "" }),
    ];
    expect(buildDirectory(rows, "2026-01-01").directory.pins["400001"][2]).toEqual(["First", "Later"]);
  });

  it("throws on an unmapped state instead of skipping the row", () => {
    expect(() => buildDirectory([row({ statename: "ATLANTIS" })], "2026-01-01")).toThrow(/ATLANTIS/);
  });

  it("records the date, the licence text and a count equal to the number of PINs", () => {
    const { directory } = buildDirectory(
      [row(), row({ pincode: "560001", statename: "KARNATAKA", district: "BANGALORE" })],
      "2026-02-03"
    );
    expect(directory.generated_at).toBe("2026-02-03");
    expect(directory.source).toMatch(/GODL|Open Data/);
    expect(directory.count).toBe(Object.keys(directory.pins).length);
    expect(directory.count).toBe(2);
  });
});
