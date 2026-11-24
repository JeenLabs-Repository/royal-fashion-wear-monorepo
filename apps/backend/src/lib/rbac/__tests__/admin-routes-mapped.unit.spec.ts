import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectMethods,
  enumerateAdminRoutesReport,
  routeFileToPattern,
} from "../enumerate-admin-routes";
import { ruleCoversRoute } from "../match-manifest";
import { PERMISSION_MANIFEST } from "../permission-manifest";

// This file is also the CI check that every admin route has a permission rule:
// `pnpm --dir apps/backend run check:admin-routes` runs only this spec.

const BACKEND_ROOT = path.resolve(__dirname, "../../../..");
const CORE_PACKAGE = "@medusajs/medusa";
const CORE_FLOOR = 100;

describe("routeFileToPattern", () => {
  test.each([
    ["node_modules/@medusajs/medusa/dist/api/admin/products/[id]/route.js", "/admin/products/:id"],
    ["src/api/admin/staff/[user_id]/roles/[role]/route.ts", "/admin/staff/:user_id/roles/:role"],
    ["api/admin/route.ts", "/admin"],
    ["dist/api/admin/orders/route.mjs", "/admin/orders"],
    ["dist/api/admin/orders/route.cjs", "/admin/orders"],
    ["C:\\repo\\dist\\api\\admin\\customers\\route.js", "/admin/customers"],
  ])("maps %s to %s", (file, pattern) => {
    expect(routeFileToPattern(file)).toBe(pattern);
  });

  test.each([
    "dist/api/admin/products/route.d.ts",
    "dist/api/admin/products/route.js.map",
    "dist/api/store/products/route.js",
    "dist/api/auth/[actor_type]/route.js",
    "dist/api/admin/products/helpers.js",
    "dist/modules/admin/route.js",
  ])("ignores %s", (file) => {
    expect(routeFileToPattern(file)).toBeNull();
  });
});

describe("detectMethods", () => {
  test.each([
    ["export async function GET(req, res) {}", ["GET"]],
    ["export function POST() {}\nexport async function DELETE() {}", ["DELETE", "POST"]],
    ["export const PUT = async () => {};", ["PUT"]],
    ["export const PATCH: Handler = async () => {};", ["PATCH"]],
    ['"use strict";\nexports.GET = GET;\nexports.POST = POST;', ["GET", "POST"]],
    ["async function GET() {}\nexport { GET };", ["GET"]],
    ["export { GET, POST as POST, helper };", ["GET", "POST"]],
    [
      'Object.defineProperty(exports, "DELETE", { enumerable: true, get: function () { return x.DELETE; } });',
      ["DELETE"],
    ],
    ["export const config = {}; function GETTER() {}", []],
  ])("reads %j", (source, expected) => {
    expect(detectMethods(source)).toEqual(
      ["GET", "POST", "DELETE", "PUT", "PATCH"].filter((method) => expected.includes(method))
    );
  });
});

describe("enumerateAdminRoutesReport on a fixture package", () => {
  let backendRoot: string;

  beforeAll(() => {
    backendRoot = fs.mkdtempSync(path.join(os.tmpdir(), "route-enum-"));
    const own = path.join(backendRoot, "src/api/admin/widgets/[id]");
    fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, "route.ts"), "export async function GET() {}\n");
    fs.writeFileSync(
      path.join(backendRoot, "package.json"),
      JSON.stringify({ name: "fixture", dependencies: {} })
    );
    fs.writeFileSync(
      path.join(backendRoot, "medusa-config.js"),
      "module.exports = { plugins: [] };\n"
    );
  });

  afterAll(() => {
    fs.rmSync(backendRoot, { recursive: true, force: true });
  });

  test("lists this project's own routes under the app source", () => {
    const report = enumerateAdminRoutesReport({ backendRoot });
    expect(report.routes).toEqual([
      { method: "GET", pattern: "/admin/widgets/:id", source: "app" },
    ]);
    expect(report.unresolved).toEqual([]);
  });
});

describe("every installed admin route has a permission rule", () => {
  const report = enumerateAdminRoutesReport({ backendRoot: BACKEND_ROOT });

  test("prints how many routes each source produced", () => {
    // eslint-disable-next-line no-console
    console.log(`[check-admin-routes] routes per source: ${JSON.stringify(report.countsBySource)}`);
    expect(report.routes.length).toBeGreaterThan(0);
  });

  test(`the ${CORE_PACKAGE} source yields at least ${CORE_FLOOR} routes`, () => {
    // An empty source is a broken check, not a pass.
    expect(report.countsBySource[CORE_PACKAGE] ?? 0).toBeGreaterThanOrEqual(CORE_FLOOR);
  });

  test("the Gorgo source yields at least one route", () => {
    const gorgo = Object.entries(report.countsBySource)
      .filter(([source]) => source.startsWith("@gorgo/"))
      .reduce((total, [, count]) => total + count, 0);
    expect(gorgo).toBeGreaterThanOrEqual(1);
  });

  test("every package in medusa-config plugins was scanned", () => {
    expect(report.pluginNames.length).toBeGreaterThan(0);
    expect(report.unresolved).toEqual([]);
  });

  test("no route is left without a rule", () => {
    const unmapped = report.routes
      .filter(
        (route) =>
          !PERMISSION_MANIFEST.some((rule) => ruleCoversRoute(rule, route.method, route.pattern))
      )
      .map((route) => `${route.method} ${route.pattern} (${route.source})`)
      .sort();
    // Printed as one block so the message names every route that needs a rule.
    expect(unmapped.join("\n")).toBe("");
  });

  test("rules that match no installed route are reported but do not fail", () => {
    const unused = PERMISSION_MANIFEST.filter(
      (rule) =>
        !report.routes.some((route) => ruleCoversRoute(rule, route.method, route.pattern))
    ).map((rule) => `${rule.method} ${rule.pattern}`);
    if (unused.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[check-admin-routes] rules with no installed route:\n${unused.join("\n")}`);
    }
    expect(Array.isArray(unused)).toBe(true);
  });
});
