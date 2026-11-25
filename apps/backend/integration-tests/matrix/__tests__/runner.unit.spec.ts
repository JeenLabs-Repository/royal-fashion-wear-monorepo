import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findMatrixProblems,
  findProblems,
  fixtureNameFor,
  listVendorRouteFiles,
  loadFixtures,
  routePathFor,
} from "../runner";
import type { MatrixEntry } from "../types";

const REAL_ROUTES = path.resolve(__dirname, "..", "..", "..", "src", "api", "vendor");
const REAL_FIXTURES = path.resolve(__dirname, "..");

const tree = (routes: Record<string, string>, fixtures: Record<string, string>) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "matrix-runner-"));
  const routeDir = path.join(root, "vendor");
  const fixtureDir = path.join(root, "matrix");
  mkdirSync(fixtureDir, { recursive: true });
  for (const [relative, source] of Object.entries(routes)) {
    const file = path.join(routeDir, relative, "route.ts");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  for (const [name, source] of Object.entries(fixtures)) {
    writeFileSync(path.join(fixtureDir, name), source);
  }
  return { routeDir, fixtureDir };
};

const fixtureSource = (entries: object[]) => `module.exports = { default: ${JSON.stringify(entries)} };`;
const GET_ROUTE = "export async function GET() {}\n";

describe("name derivation", () => {
  it.each([
    ["/vendor/me/locations", "me__locations.ts"],
    ["/vendor/agreement/accept", "agreement__accept.ts"],
    ["/vendor/accept-invite", "accept-invite.ts"],
    ["/vendor/me/password", "me__password.ts"],
    ["/vendor/things/:id", "things___id_.ts"],
    ["/vendor/things/:id/parts", "things___id___parts.ts"],
  ])("%s becomes %s", (routePath, expected) => {
    expect(fixtureNameFor(routePath)).toBe(expected);
  });

  it("turns folder names into route paths", () => {
    const routeDir = path.join(os.tmpdir(), "vendor");
    expect(routePathFor(path.join(routeDir, "me", "locations", "route.ts"), routeDir)).toBe(
      "/vendor/me/locations"
    );
    expect(routePathFor(path.join(routeDir, "things", "[id]", "route.ts"), routeDir)).toBe(
      "/vendor/things/:id"
    );
  });
});

describe("listVendorRouteFiles", () => {
  it("lists the routes and their exported methods", () => {
    const { routeDir } = tree(
      {
        me: GET_ROUTE,
        "agreement/accept": "export async function POST() {}\nexport const GET = () => {};\n",
      },
      {}
    );
    expect(listVendorRouteFiles(routeDir).map((route) => [route.routePath, route.methods])).toEqual([
      ["/vendor/agreement/accept", ["GET", "POST"]],
      ["/vendor/me", ["GET"]],
    ]);
  });

  it("finds the vendor routes the API ships today", () => {
    const routes = listVendorRouteFiles(REAL_ROUTES);
    expect(routes.map((route) => route.routePath)).toEqual(
      expect.arrayContaining([
        "/vendor/me",
        "/vendor/onboarding",
        "/vendor/agreement/current",
        "/vendor/agreement/accept",
        "/vendor/me/locations",
        "/vendor/me/password",
        "/vendor/accept-invite",
        "/vendor/uploads",
        "/vendor/categories",
        "/vendor/products",
        "/vendor/products/:id",
        "/vendor/products/:id/submit",
        "/vendor/products/:id/withdraw",
        "/vendor/products/:id/discard-changes",
        "/vendor/inventory",
        "/vendor/inventory/import",
        "/vendor/inventory/export",
        "/vendor/inventory/template",
      ])
    );
    expect(routes).toHaveLength(18);
  });
});

describe("findMatrixProblems", () => {
  it("reports a route without a fixture, with a fix hint", () => {
    const { routeDir, fixtureDir } = tree({ me: GET_ROUTE }, {});
    const problems = findMatrixProblems(routeDir, fixtureDir);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toBe("Missing matrix fixture for /vendor/me");
    expect(problems[0].hint).toContain("integration-tests/matrix/me.ts");
  });

  it("reports an exported method that the fixture does not cover", () => {
    const { routeDir, fixtureDir } = tree(
      { me: "export async function GET() {}\nexport async function POST() {}\n" },
      { "me.js": fixtureSource([{ method: "GET", path: "/vendor/me" }]) }
    );
    const problems = findMatrixProblems(routeDir, fixtureDir);
    expect(problems.map((problem) => problem.problem)).toEqual([
      "/vendor/me exports POST but fixture me.ts has no POST entry",
    ]);
  });

  it("reports an entry whose path differs from the route", () => {
    const { routeDir, fixtureDir } = tree(
      { me: GET_ROUTE },
      { "me.js": fixtureSource([{ method: "GET", path: "/vendor/other" }]) }
    );
    const problems = findMatrixProblems(routeDir, fixtureDir);
    expect(problems.map((problem) => problem.problem)).toEqual([
      "Fixture me.ts has an entry with path /vendor/other, but the route is /vendor/me",
    ]);
  });

  it.each(["PUT", "PATCH"])("reports an exported %s handler", (method) => {
    const { routeDir, fixtureDir } = tree(
      { me: `export async function ${method}() {}\n` },
      { "me.js": fixtureSource([{ method, path: "/vendor/me" }]) }
    );
    const problems = findMatrixProblems(routeDir, fixtureDir);
    expect(problems.map((problem) => problem.problem)).toContain(
      `/vendor/me exports ${method}, which vendor routes do not use`
    );
  });

  it("allows PUT only on /vendor/inventory", () => {
    const { routeDir, fixtureDir } = tree(
      {
        inventory: "export async function GET() {}\nexport async function PUT() {}\n",
      },
      {
        "inventory.js": fixtureSource([
          { method: "GET", path: "/vendor/inventory" },
          { method: "PUT", path: "/vendor/inventory" },
        ]),
      }
    );
    expect(findMatrixProblems(routeDir, fixtureDir)).toEqual([]);
  });

  it("fails when a real compliance route exists and only the placeholder fixture does", () => {
    const { routeDir, fixtureDir } = tree(
      { "compliance/ping": GET_ROUTE },
      {
        "plugin__compliance.js": fixtureSource([
          { method: "GET", path: "/vendor/compliance/*", plugin: true },
        ]),
      }
    );
    const problems = findMatrixProblems(routeDir, fixtureDir).map((problem) => problem.problem);
    expect(problems).toContain("Missing matrix fixture for /vendor/compliance/ping");
    expect(problems.some((problem) => problem.includes("still a plugin placeholder"))).toBe(true);
  });

  it("accepts a placeholder while no compliance route exists", () => {
    const { routeDir, fixtureDir } = tree(
      { me: GET_ROUTE },
      {
        "me.js": fixtureSource([{ method: "GET", path: "/vendor/me" }]),
        "plugin__compliance.js": fixtureSource([
          { method: "GET", path: "/vendor/compliance/*", plugin: true },
        ]),
      }
    );
    expect(findMatrixProblems(routeDir, fixtureDir)).toEqual([]);
  });

  it("ignores the reserved code files in the fixture folder", () => {
    const { routeDir, fixtureDir } = tree(
      { me: GET_ROUTE },
      {
        "me.js": fixtureSource([{ method: "GET", path: "/vendor/me" }]),
        "runner.js": "throw new Error('must not be loaded');",
        "types.js": "throw new Error('must not be loaded');",
      }
    );
    expect(findMatrixProblems(routeDir, fixtureDir)).toEqual([]);
  });

  it("works on plain data without files", () => {
    const fixtures = new Map<string, MatrixEntry[]>([
      ["me", [{ method: "GET", path: "/vendor/me" }]],
    ]);
    expect(findProblems([{ file: "x", routePath: "/vendor/me", methods: ["GET"] }], fixtures)).toEqual(
      []
    );
  });

  it("returns an empty list for the current tree", () => {
    expect(findMatrixProblems(REAL_ROUTES, REAL_FIXTURES)).toEqual([]);
  });

  it("loads every shipped fixture", () => {
    const fixtures = loadFixtures(REAL_FIXTURES);
    expect([...fixtures.keys()].sort()).toEqual(
      expect.arrayContaining([
        "accept-invite",
        "agreement__accept",
        "agreement__current",
        "categories",
        "inventory",
        "inventory__export",
        "inventory__import",
        "inventory__template",
        "me",
        "me__locations",
        "me__password",
        "onboarding",
        "plugin__compliance",
        "products",
        "products___id_",
        "products___id___discard-changes",
        "products___id___submit",
        "products___id___withdraw",
        "uploads",
      ])
    );
  });
});
