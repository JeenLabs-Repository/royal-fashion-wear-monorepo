import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { MatrixEntry } from "./types";

export type VendorRouteFile = { file: string; routePath: string; methods: string[] };
export type MatrixProblem = { problem: string; hint: string };

const METHOD_PATTERNS = [
  /export\s+async\s+function\s+(GET|POST|DELETE|PUT|PATCH)\b/g,
  /export\s+const\s+(GET|POST|DELETE|PUT|PATCH)\b/g,
];

// Files in the matrix folder that are code, not fixtures.
const RESERVED = new Set(["types", "runner"]);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return name === "route.ts" ? [full] : [];
  });

// The route path of a route file: folder names after the route directory, with
// [name] written as :name.
export const routePathFor = (file: string, routeDir: string): string => {
  const segments = path
    .relative(routeDir, path.dirname(file))
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => segment.replace(/^\[(.+)\]$/, ":$1"));
  return `/vendor${segments.length > 0 ? `/${segments.join("/")}` : ""}`;
};

// me/locations gives me__locations.ts, [id] segments become _id_.
export const fixtureNameFor = (routePath: string): string =>
  `${routePath
    .replace(/^\/vendor\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/^:(.+)$/, "_$1_"))
    .join("__")}.ts`;

export const listVendorRouteFiles = (routeDir: string): VendorRouteFile[] => {
  if (!existsSync(routeDir)) {
    return [];
  }
  return walk(routeDir)
    .map((file) => {
      const source = readFileSync(file, "utf8");
      const methods = new Set<string>();
      for (const pattern of METHOD_PATTERNS) {
        for (const match of source.matchAll(pattern)) {
          methods.add(match[1]);
        }
      }
      return { file, routePath: routePathFor(file, routeDir), methods: [...methods].sort() };
    })
    .sort((a, b) => a.routePath.localeCompare(b.routePath));
};

// Loads every fixture module of the folder (not the reserved code files and not
// anything below __tests__). Returns entries by fixture name without extension.
export const loadFixtures = (fixtureDir: string): Map<string, MatrixEntry[]> => {
  const fixtures = new Map<string, MatrixEntry[]>();
  if (!existsSync(fixtureDir)) {
    return fixtures;
  }
  for (const name of readdirSync(fixtureDir)) {
    const full = path.join(fixtureDir, name);
    if (statSync(full).isDirectory() || !/\.(ts|js)$/.test(name)) {
      continue;
    }
    const base = name.replace(/\.(ts|js)$/, "");
    if (RESERVED.has(base)) {
      continue;
    }
    const loaded = require(full);
    const entries = (loaded.default ?? loaded) as MatrixEntry[];
    fixtures.set(base, entries);
  }
  return fixtures;
};

// The rules, over plain data so every one can be tested without files.
export const findProblems = (
  routes: VendorRouteFile[],
  fixtures: Map<string, MatrixEntry[]>
): MatrixProblem[] => {
  const problems: MatrixProblem[] = [];

  for (const route of routes) {
    const expected = fixtureNameFor(route.routePath);
    const key = expected.replace(/\.ts$/, "");
    const entries = fixtures.get(key);
    const forbidden = route.methods.filter((method) => method === "PUT" || method === "PATCH");

    for (const method of forbidden) {
      problems.push({
        problem: `${route.routePath} exports ${method}, which vendor routes do not use`,
        hint: "Use POST for updates and DELETE for removals. Only GET, POST and DELETE are allowed.",
      });
    }

    if (!entries) {
      problems.push({
        problem: `Missing matrix fixture for ${route.routePath}`,
        hint: `Create integration-tests/matrix/${expected} with one entry per exported method. See docs/guides/add-a-vendor-route.md.`,
      });
      continue;
    }

    for (const method of route.methods.filter((method) => method !== "PUT" && method !== "PATCH")) {
      if (!entries.some((entry) => entry.method === method)) {
        problems.push({
          problem: `${route.routePath} exports ${method} but fixture ${expected} has no ${method} entry`,
          hint: `Add an entry with method "${method}" and path "${route.routePath}" to integration-tests/matrix/${expected}.`,
        });
      }
    }

    for (const entry of entries) {
      if (!entry.plugin && entry.path !== route.routePath) {
        problems.push({
          problem: `Fixture ${expected} has an entry with path ${entry.path}, but the route is ${route.routePath}`,
          hint: "The entry path must equal the route path, with :name for dynamic segments.",
        });
      }
    }
  }

  const compliance = routes.filter((route) => route.routePath.startsWith("/vendor/compliance"));
  if (compliance.length > 0) {
    const placeholders = [...fixtures.entries()].filter(([, entries]) =>
      entries.some((entry) => entry.plugin)
    );
    for (const [name] of placeholders) {
      problems.push({
        problem: `Fixture ${name} is still a plugin placeholder, but real routes exist under /vendor/compliance`,
        hint: "Replace the placeholder with real fixtures named after each plugin route file, and remove the plugin flag.",
      });
    }
  }

  return problems;
};

export const findMatrixProblems = (routeDir: string, fixtureDir: string): MatrixProblem[] =>
  findProblems(listVendorRouteFiles(routeDir), loadFixtures(fixtureDir));
