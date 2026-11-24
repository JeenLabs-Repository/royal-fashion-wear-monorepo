import { normalizeAdminPath, normalizeMethod } from "../normalize-path";

describe("normalizeAdminPath", () => {
  describe.each([
    ["/admin/products", "/admin/products", "/admin/products"],
    ["/admin/products/?x=1", "/admin/products", "/admin/products"],
    ["/admin/products?x=1&y=2", "/admin/products", "/admin/products"],
    ["/admin/products#section", "/admin/products", "/admin/products"],
    ["//admin//products", "/admin/products", "/admin/products"],
    ["/admin///products//", "/admin/products", "/admin/products"],
    ["/Admin/Products", "/admin/products", "/Admin/Products"],
    ["/admin/%69ntegrations", "/admin/integrations", "/admin/integrations"],
    ["/admin/%49ntegrations", "/admin/integrations", "/admin/Integrations"],
    ["/admin/integrations;x=1", "/admin/integrations", "/admin/integrations"],
    ["/admin;x=1/integrations", "/admin/integrations", "/admin/integrations"],
    ["/admin/integrations/", "/admin/integrations", "/admin/integrations"],
    ["/admin/Users/UsEr_AbC", "/admin/users/user_abc", "/admin/Users/UsEr_AbC"],
    ["/admin/a;b/c;d=1/", "/admin/a/c", "/admin/a/c"],
    ["/", "/", "/"],
  ])("accepts %s", (raw, matchPath, casePath) => {
    test("gives the expected match and case paths", () => {
      expect(normalizeAdminPath(raw)).toEqual({ ok: true, matchPath, casePath });
    });
  });

  describe.each([
    ["/admin/../x", "dot_segment"],
    ["/admin/./x", "dot_segment"],
    ["/admin/%2e%2e/x", "dot_segment"],
    ["/admin/%2E/x", "dot_segment"],
    ["/admin/..;x/y", "dot_segment"],
    ["/admin/%zz", "bad_encoding"],
    ["/admin/100%", "bad_encoding"],
    ["/admin/%2569ntegrations", "double_encoding"],
    ["/admin/%252e%252e/x", "double_encoding"],
    ["/admin/a\\b", "forbidden_character"],
    ["/admin/%5cb", "forbidden_character"],
    ["/admin/a%00b", "forbidden_character"],
    ["/admin/a\u0000b", "forbidden_character"],
    ["/admin/a\tb", "forbidden_character"],
    ["/admin/products%2fx", "forbidden_character"],
    ["admin/products", "forbidden_character"],
    ["", "forbidden_character"],
  ])("rejects %j", (raw, reason) => {
    test(`with the reason ${reason}`, () => {
      expect(normalizeAdminPath(raw)).toEqual({ ok: false, reason });
    });
  });

  test("keeps the letter case of ids in the case path while matching in lower case", () => {
    const result = normalizeAdminPath("/ADMIN/users/USER_01HX");
    expect(result).toEqual({
      ok: true,
      matchPath: "/admin/users/user_01hx",
      casePath: "/ADMIN/users/USER_01HX",
    });
  });
});

describe("normalizeMethod", () => {
  test.each([
    ["get", "GET"],
    ["Post", "POST"],
    ["HEAD", "GET"],
    ["head", "GET"],
    ["OPTIONS", "OPTIONS"],
    ["options", "OPTIONS"],
  ])("%s becomes %s", (input, expected) => {
    expect(normalizeMethod(input)).toBe(expected);
  });
});
