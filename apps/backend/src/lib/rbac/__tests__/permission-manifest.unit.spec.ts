import { PERMISSIONS } from "../permissions";
import { resolveRule, type ManifestRule } from "../match-manifest";
import { normalizeAdminPath } from "../normalize-path";
import {
  GUARD_NAMES,
  PERMISSION_MANIFEST,
  SELF_GET_PATTERNS,
} from "../permission-manifest";

const PSEUDO = ["superadmin", "self", "core-handled"];
const MUTATING = ["POST", "DELETE", "PUT", "PATCH"];

const resolve = (method: string, url: string) => {
  const path = normalizeAdminPath(url);
  if (!path.ok) {
    throw new Error(`test path rejected: ${url}`);
  }
  return resolveRule(PERMISSION_MANIFEST, method, path.matchPath)?.rule ?? null;
};

const describeRule = (rule: ManifestRule) => `${rule.method} ${rule.pattern}`;

describe("permission manifest policy", () => {
  test("every rule permission is a catalogue string or a pseudo permission", () => {
    const known = new Set<string>([...PERMISSIONS, ...PSEUDO]);
    const unknown = PERMISSION_MANIFEST.filter((rule) => !known.has(rule.permission)).map(
      describeRule
    );
    expect(unknown).toEqual([]);
  });

  test("every guard name is in the closed guard list", () => {
    const names = new Set<string>(GUARD_NAMES);
    const unknown = PERMISSION_MANIFEST.filter((rule) =>
      (rule.guards ?? []).some((guard) => !names.has(guard))
    ).map(describeRule);
    expect(unknown).toEqual([]);
  });

  test("a mutating rule never uses a read permission or documents:export", () => {
    const offenders = PERMISSION_MANIFEST.filter(
      (rule) =>
        MUTATING.includes(rule.method) &&
        (rule.permission.endsWith(":read") || rule.permission === "documents:export")
    ).map(describeRule);
    expect(offenders).toEqual([]);
  });

  test("no rule covers every method with a read permission", () => {
    const offenders = PERMISSION_MANIFEST.filter(
      (rule) => rule.method === "*" && rule.permission.endsWith(":read")
    ).map(describeRule);
    expect(offenders).toEqual([]);
  });

  test("self appears only on GET rules for the allowed patterns", () => {
    const offenders = PERMISSION_MANIFEST.filter(
      (rule) =>
        rule.permission === "self" &&
        !(rule.method === "GET" && SELF_GET_PATTERNS.includes(rule.pattern))
    ).map(describeRule);
    expect(offenders).toEqual([]);
    expect([...SELF_GET_PATTERNS].sort()).toEqual(
      expect.arrayContaining(["/admin/staff/me", "/admin/users/me"])
    );
  });

  test("core-handled appears only on POST /admin/invites/accept", () => {
    const coreHandled = PERMISSION_MANIFEST.filter((rule) => rule.permission === "core-handled");
    expect(coreHandled.map(describeRule)).toEqual(["POST /admin/invites/accept"]);
  });

  test("no pattern has an upper-case letter or a trailing slash", () => {
    const offenders = PERMISSION_MANIFEST.filter(
      (rule) => rule.pattern !== rule.pattern.toLowerCase() || rule.pattern.endsWith("/")
    ).map(describeRule);
    expect(offenders).toEqual([]);
  });

  test("there are more than 60 rules and no method and pattern appears twice", () => {
    expect(PERMISSION_MANIFEST.length).toBeGreaterThan(60);
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const rule of PERMISSION_MANIFEST) {
      const key = describeRule(rule);
      if (seen.has(key)) {
        duplicates.push(key);
      }
      seen.add(key);
    }
    expect(duplicates).toEqual([]);
  });
});

describe("integrations lockdown", () => {
  const methods = ["GET", "POST", "DELETE", "PUT", "PATCH"];

  test.each(methods)("%s on /admin/integrations and below needs integrations:manage", (method) => {
    for (const url of ["/admin/integrations", "/admin/integrations/", "/admin/integrations/a/b"]) {
      expect(resolve(method, url)?.permission).toBe("integrations:manage");
    }
  });

  test("a rule exists for each of the five methods", () => {
    const covered = PERMISSION_MANIFEST.filter(
      (rule) => rule.pattern === "/admin/integrations*" && rule.permission === "integrations:manage"
    ).map((rule) => rule.method);
    expect(covered.sort()).toEqual([...methods].sort());
  });
});

describe("resolution table", () => {
  // Every row carries an explicit guards list (empty when none) so Jest does
  // not inject its done callback into a missing fourth column.
  const cases: Array<[string, string, string | null, string[]]> = [
    ["GET", "/admin/staff/me", "self", []],
    ["GET", "/admin/staff", "staff:manage", []],
    ["POST", "/admin/staff/u1/roles", "staff:manage", ["protect-staff-target"]],
    ["DELETE", "/admin/staff/u1/roles/support", "staff:manage", ["protect-staff-target"]],
    ["POST", "/admin/staff/break-glass-reviews/r1/close", "staff:manage", []],
    ["GET", "/admin/users/me", "self", []],
    ["DELETE", "/admin/users/u1", "staff:manage", ["protect-staff-target"]],
    ["POST", "/admin/users/u1", "staff:manage", ["protect-staff-target"]],
    ["GET", "/admin/users", "staff:manage", []],
    ["GET", "/admin/invites", "staff:manage", []],
    ["POST", "/admin/invites/accept", "core-handled", []],
    ["POST", "/admin/invites", "staff:manage", []],
    ["GET", "/admin/api-keys", "superadmin", []],
    ["GET", "/admin/audit-log", "audit:read", []],
    ["POST", "/admin/payments/p1/refund", "finance:refund", []],
    ["GET", "/admin/payments", "finance:read", []],
    ["POST", "/admin/payments/p1/capture", "orders:write", []],
    ["GET", "/admin/products", "catalog:read", []],
    ["POST", "/admin/products", "catalog:edit", []],
    ["DELETE", "/admin/products/p1", "catalog:edit", []],
    ["GET", "/admin/orders", "orders:read", []],
    ["POST", "/admin/orders/o1/cancel", "orders:write", []],
    ["GET", "/admin/customers", "customers:read", []],
    ["DELETE", "/admin/customers/c1", "superadmin", []],
    ["GET", "/admin/returns", "returns:read", []],
    ["POST", "/admin/returns", "returns:decide", []],
    ["GET", "/admin/routing/queue", "routing:read", []],
    ["POST", "/admin/routing/assign", "routing:assign", []],
    ["GET", "/admin/price-lists", "catalog:read", []],
    ["POST", "/admin/price-lists", "superadmin", []],
    ["GET", "/admin/regions", "superadmin", []],
    ["GET", "/admin/not-listed", null, []],
    ["POST", "/admin/not-listed/deep/path", null, []],
  ];

  test.each(cases)("%s %s resolves to %s", (method, url, permission, guards) => {
    const rule = resolve(method, url);
    expect(rule?.permission ?? null).toBe(permission);
    expect([...(rule?.guards ?? [])]).toEqual(guards);
  });

  test("path variants resolve like the plain path", () => {
    expect(resolve("GET", "/Admin//Integrations/")?.permission).toBe("integrations:manage");
    expect(resolve("GET", "/admin/%69ntegrations;x=1")?.permission).toBe("integrations:manage");
  });
});

describe("self reads", () => {
  const concrete = (pattern: string) =>
    pattern.replace(/\*$/, "").replace(/:[A-Za-z_]+/g, "x1") || "/admin";

  it.each([...SELF_GET_PATTERNS])("%s resolves to self for GET only", (pattern) => {
    const path = concrete(pattern);
    expect(resolveRule(PERMISSION_MANIFEST, "GET", path)?.rule.permission).toBe("self");
    for (const method of ["POST", "DELETE", "PUT", "PATCH"] as const) {
      expect(resolveRule(PERMISSION_MANIFEST, method, path)?.rule.permission).not.toBe("self");
    }
  });

  it("has a GET self rule for every listed pattern and no other self rule", () => {
    const selfRules = PERMISSION_MANIFEST.filter((rule) => rule.permission === "self");
    expect(selfRules.every((rule) => rule.method === "GET")).toBe(true);
    expect(selfRules.map((rule) => rule.pattern).sort()).toEqual([...SELF_GET_PATTERNS].sort());
  });

  it("never lists an upper-case pattern as a self read", () => {
    for (const pattern of SELF_GET_PATTERNS) {
      expect(pattern).toBe(pattern.toLowerCase());
    }
  });

  // Family wildcards are allowed only for measured shell prefixes that expose no
  // business data (store, layouts, notifications, cloud announcements).
  it("only allows measured shell wildcards in self reads", () => {
    const allowedWildcards = new Set([
      "/admin/stores*",
      "/admin/layouts*",
      "/admin/notifications*",
      "/admin/cloud/announcements*",
    ]);
    for (const pattern of SELF_GET_PATTERNS) {
      if (pattern.includes("*")) {
        expect(allowedWildcards.has(pattern)).toBe(true);
      }
    }
  });
});
