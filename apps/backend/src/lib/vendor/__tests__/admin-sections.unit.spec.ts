import {
  __resetVendorAdminSectionsForTests,
  listVendorAdminSections,
  registerVendorAdminSection,
} from "../admin-sections";

beforeEach(() => {
  __resetVendorAdminSectionsForTests();
});

const base = { key: "compliance", title: "Compliance", path: "/vendors/:vendorId/compliance" };

describe("registerVendorAdminSection", () => {
  test("stores a section and lists it with the vendor id put into the path", () => {
    registerVendorAdminSection(base);
    expect(listVendorAdminSections("vnd_1")).toEqual([
      { key: "compliance", title: "Compliance", path: "/vendors/vnd_1/compliance" },
    ]);
  });

  test("lists nothing when nothing is registered", () => {
    expect(listVendorAdminSections("vnd_1")).toEqual([]);
  });

  test("keeps registration order", () => {
    registerVendorAdminSection({ ...base, key: "one", title: "One" });
    registerVendorAdminSection({ ...base, key: "two", title: "Two" });
    expect(listVendorAdminSections("vnd_1").map((section) => section.key)).toEqual([
      "one",
      "two",
    ]);
  });

  test("rejects a duplicate key", () => {
    registerVendorAdminSection(base);
    expect(() => registerVendorAdminSection(base)).toThrow(/already registered/);
  });

  test.each([
    ["an absolute url", "https://example.test/x"],
    ["a protocol-relative url", "//example.test/x"],
    ["a script scheme", "javascript:alert(1)"],
    ["a path without a leading slash", "vendors/compliance"],
    ["a dot segment", "/vendors/../settings"],
    ["a backslash", "/vendors\\x"],
    ["whitespace", "/vendors/has space"],
    ["a percent escape", "/vendors/%2e%2e/settings"],
    ["a colon that is not the placeholder", "/vendors/:other/compliance"],
  ])("rejects a path that is %s", (_label, path) => {
    expect(() => registerVendorAdminSection({ ...base, path })).toThrow(
      /must be a path inside the Admin/
    );
  });

  test.each(["/vendors/compliance", "/vendors/:vendorId", "/plugins/:vendorId/a/b"])(
    "accepts the path %s",
    (path) => {
      expect(() => registerVendorAdminSection({ ...base, path })).not.toThrow();
    }
  );

  test("rejects a bad key and a bad title", () => {
    expect(() => registerVendorAdminSection({ ...base, key: "Bad Key" })).toThrow(
      /lower-case letters/
    );
    expect(() => registerVendorAdminSection({ ...base, title: "  " })).toThrow(
      /1 to 80 characters/
    );
  });

  test("encodes the vendor id so it cannot change the path", () => {
    registerVendorAdminSection(base);
    const [section] = listVendorAdminSections("../x");
    expect(section.path).toBe("/vendors/..%2Fx/compliance");
  });
});
