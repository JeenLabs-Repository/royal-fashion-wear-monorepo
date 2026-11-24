import {
  extractParams,
  resolveRule,
  ruleCoversRoute,
  type ManifestRule,
} from "../match-manifest";

const rule = (
  method: ManifestRule["method"],
  pattern: string,
  permission: string
): ManifestRule => ({ method, pattern, permission } as ManifestRule);

const patternOf = (rules: ManifestRule[], method: string, path: string) =>
  resolveRule(rules, method, path)?.rule.pattern ?? null;

describe("resolveRule", () => {
  test("a trailing star covers the segment and everything below it", () => {
    const rules = [rule("GET", "/admin/products*", "a")];
    expect(patternOf(rules, "GET", "/admin/products")).toBe("/admin/products*");
    expect(patternOf(rules, "GET", "/admin/products/x/y")).toBe("/admin/products*");
  });

  test("a trailing star does not cover a longer first segment", () => {
    const rules = [rule("GET", "/admin/products*", "a")];
    expect(patternOf(rules, "GET", "/admin/productsx")).toBeNull();
    expect(patternOf(rules, "GET", "/admin/product")).toBeNull();
  });

  test("a named parameter matches exactly one segment", () => {
    const rules = [rule("GET", "/admin/orders/:id", "a")];
    expect(patternOf(rules, "GET", "/admin/orders/o1")).toBe("/admin/orders/:id");
    expect(patternOf(rules, "GET", "/admin/orders")).toBeNull();
    expect(patternOf(rules, "GET", "/admin/orders/o1/x")).toBeNull();
  });

  test("an exact pattern needs the same number of segments", () => {
    const rules = [rule("GET", "/admin/staff/me", "a")];
    expect(patternOf(rules, "GET", "/admin/staff/me")).toBe("/admin/staff/me");
    expect(patternOf(rules, "GET", "/admin/staff/me/x")).toBeNull();
    expect(patternOf(rules, "GET", "/admin/staff")).toBeNull();
  });

  test("more literal segments win over a wildcard", () => {
    const rules = [
      rule("GET", "/admin/staff*", "wide"),
      rule("GET", "/admin/staff/me", "narrow"),
    ];
    expect(resolveRule(rules, "GET", "/admin/staff/me")?.rule.permission).toBe("narrow");
    expect(resolveRule(rules, "GET", "/admin/staff/other")?.rule.permission).toBe("wide");
  });

  test("an exact pattern beats a wildcard of equal literal count", () => {
    const rules = [
      rule("DELETE", "/admin/users*", "wide"),
      rule("DELETE", "/admin/users/:id", "exact"),
    ];
    expect(resolveRule(rules, "DELETE", "/admin/users/u1")?.rule.permission).toBe("exact");
    expect(resolveRule(rules, "DELETE", "/admin/users")?.rule.permission).toBe("wide");
  });

  test("an explicit method beats the any-method rule of the same pattern", () => {
    const rules = [rule("*", "/admin/x*", "any"), rule("POST", "/admin/x*", "post")];
    expect(resolveRule(rules, "POST", "/admin/x")?.rule.permission).toBe("post");
    expect(resolveRule(rules, "GET", "/admin/x")?.rule.permission).toBe("any");
  });

  test("a tie goes to the earlier rule", () => {
    const first = [rule("GET", "/admin/x*", "first"), rule("GET", "/admin/x*", "second")];
    expect(resolveRule(first, "GET", "/admin/x")?.rule.permission).toBe("first");
    const swapped = [rule("GET", "/admin/x*", "second"), rule("GET", "/admin/x*", "first")];
    expect(resolveRule(swapped, "GET", "/admin/x")?.rule.permission).toBe("second");
  });

  test("HEAD resolves like GET and a rule for another method does not match", () => {
    const rules = [rule("GET", "/admin/x*", "get")];
    expect(resolveRule(rules, "HEAD", "/admin/x")?.rule.permission).toBe("get");
    expect(resolveRule(rules, "POST", "/admin/x")).toBeNull();
  });

  test("OPTIONS matches nothing", () => {
    const rules = [rule("*", "/admin/x*", "any")];
    expect(resolveRule(rules, "OPTIONS", "/admin/x")).toBeNull();
  });

  test("no rule means null, so the caller applies default deny", () => {
    expect(resolveRule([], "GET", "/admin/anything")).toBeNull();
    expect(resolveRule([rule("GET", "/admin/a*", "a")], "GET", "/admin/b")).toBeNull();
  });

  test("a catch-all pattern is refused when it is compiled", () => {
    expect(() => resolveRule([rule("GET", "/*", "a")], "GET", "/admin")).toThrow(
      /catch-all/
    );
    expect(() => resolveRule([rule("GET", "admin", "a")], "GET", "/admin")).toThrow(
      /start with a slash/
    );
  });

  test("a star inside a pattern is refused", () => {
    expect(() => resolveRule([rule("GET", "/ad*min/x", "a")], "GET", "/admin/x")).toThrow(
      /misplaced star/
    );
  });
});

describe("extractParams", () => {
  test("returns named segments in their original case", () => {
    expect(
      extractParams("/admin/staff/:user_id/roles/:role", "/admin/staff/UsEr_1/roles/Support")
    ).toEqual({ user_id: "UsEr_1", role: "Support" });
  });

  test("returns an empty object for a pattern without parameters or no match", () => {
    expect(extractParams("/admin/staff/me", "/admin/staff/me")).toEqual({});
    expect(extractParams("/admin/users/:id", "/admin/orders/o1")).toEqual({});
  });
});

describe("ruleCoversRoute", () => {
  test("a rule parameter covers a route literal and a route parameter", () => {
    const r = rule("GET", "/admin/orders/:id", "a");
    expect(ruleCoversRoute(r, "GET", "/admin/orders/:id")).toBe(true);
    expect(ruleCoversRoute(r, "GET", "/admin/orders/recent")).toBe(true);
  });

  test("a route parameter is not covered by a rule literal", () => {
    const r = rule("GET", "/admin/staff/me", "a");
    expect(ruleCoversRoute(r, "GET", "/admin/staff/:id")).toBe(false);
    expect(ruleCoversRoute(r, "GET", "/admin/staff/me")).toBe(true);
  });

  test("a trailing star covers the rest of the route", () => {
    const r = rule("GET", "/admin/products*", "a");
    expect(ruleCoversRoute(r, "GET", "/admin/products")).toBe(true);
    expect(ruleCoversRoute(r, "GET", "/admin/products/:id/variants")).toBe(true);
    expect(ruleCoversRoute(r, "GET", "/admin/productsx")).toBe(false);
  });

  test("a route parameter inside the covered prefix is not covered", () => {
    const r = rule("GET", "/admin/products*", "a");
    expect(ruleCoversRoute(r, "GET", "/admin/:thing/x")).toBe(false);
  });

  test("the method has to match unless the rule covers any method", () => {
    expect(ruleCoversRoute(rule("GET", "/admin/x*", "a"), "POST", "/admin/x")).toBe(false);
    expect(ruleCoversRoute(rule("*", "/admin/x*", "a"), "POST", "/admin/x")).toBe(true);
  });
});
