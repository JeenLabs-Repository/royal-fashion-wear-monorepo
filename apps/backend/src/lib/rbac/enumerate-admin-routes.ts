// Lists every admin route the running backend could expose, so a build can fail
// when a route has no permission rule. Three sources: this project's own
// src/api/admin, the installed @medusajs packages, and the installed @gorgo
// packages, plus every package named in the plugins array of medusa-config.
//
// Only Node's fs is used, no glob package. The plugin list is read by loading
// medusa-config, which works under Jest (the unit runner transforms
// TypeScript) and not under plain node.

import fs from "node:fs";
import path from "node:path";

export const ROUTE_METHODS = ["GET", "POST", "DELETE", "PUT", "PATCH"] as const;
export type RouteMethod = (typeof ROUTE_METHODS)[number];

export type EnumeratedRoute = { method: RouteMethod; pattern: string; source: string };

export type EnumerationReport = {
  routes: EnumeratedRoute[];
  countsBySource: Record<string, number>;
  /** Packages named in dependencies or the plugins array that could not be found on disk. */
  unresolved: string[];
  /** Package names read from the plugins array of medusa-config. */
  pluginNames: string[];
};

const ROUTE_FILE = /(?:^|\/)api\/(admin(?:\/.*)?)\/route\.(?:ts|js|mjs|cjs)$/;

/**
 * `.../api/admin/products/[id]/route.ts` gives `/admin/products/:id`. Anything
 * that is not a route file under an `api/admin` path, including type
 * declarations and source maps, gives null.
 */
export function routeFileToPattern(filePath: string): string | null {
  const normalised = filePath.replace(/\\/g, "/");
  if (/\.d\.ts$/.test(normalised) || /\.map$/.test(normalised)) {
    return null;
  }
  const match = ROUTE_FILE.exec(normalised);
  if (!match) {
    return null;
  }
  const segments = match[1]
    .split("/")
    .map((segment) => segment.replace(/^\[([^\]]+)\]$/, ":$1"));
  return `/${segments.join("/")}`;
}

const METHOD_NAMES = "GET|POST|DELETE|PUT|PATCH";
const EXPORT_FORMS: RegExp[] = [
  new RegExp(`export\\s+(?:async\\s+)?function\\s+(${METHOD_NAMES})\\b`, "g"),
  new RegExp(`export\\s+const\\s+(${METHOD_NAMES})\\b`, "g"),
  new RegExp(`exports\\.(${METHOD_NAMES})\\s*=`, "g"),
  new RegExp(`Object\\.defineProperty\\(\\s*exports\\s*,\\s*["'](${METHOD_NAMES})["']`, "g"),
];
const EXPORT_CLAUSE = /export\s*\{([^}]*)\}/g;

/** Finds which HTTP methods a route file exports, in TypeScript and compiled forms. */
export function detectMethods(source: string): RouteMethod[] {
  const found = new Set<RouteMethod>();
  for (const form of EXPORT_FORMS) {
    form.lastIndex = 0;
    for (const match of source.matchAll(form)) {
      found.add(match[1] as RouteMethod);
    }
  }
  for (const clause of source.matchAll(EXPORT_CLAUSE)) {
    for (const name of clause[1].matchAll(new RegExp(`\\b(${METHOD_NAMES})\\b`, "g"))) {
      found.add(name[1] as RouteMethod);
    }
  }
  return ROUTE_METHODS.filter((method) => found.has(method));
}

function walk(directory: string, visit: (file: string) => void): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full, visit);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

function collect(root: string, source: string): EnumeratedRoute[] {
  const routes = new Map<string, EnumeratedRoute>();
  walk(root, (file) => {
    const pattern = routeFileToPattern(path.relative(root, file));
    if (!pattern) {
      return;
    }
    for (const method of detectMethods(fs.readFileSync(file, "utf8"))) {
      routes.set(`${method} ${pattern}`, { method, pattern, source });
    }
  });
  return [...routes.values()];
}

function resolvePackageDirectory(name: string, backendRoot: string): string | null {
  try {
    const manifest = require.resolve(`${name}/package.json`, { paths: [backendRoot] });
    return fs.realpathSync(path.dirname(manifest));
  } catch {
    // An exports map can hide package.json; climb from the entry point instead.
  }
  try {
    let directory = path.dirname(require.resolve(name, { paths: [backendRoot] }));
    for (;;) {
      const candidate = path.join(directory, "package.json");
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: string };
        if (parsed.name === name) {
          return fs.realpathSync(directory);
        }
      }
      const parent = path.dirname(directory);
      if (parent === directory) {
        return null;
      }
      directory = parent;
    }
  } catch {
    return null;
  }
}

function readPluginNames(backendRoot: string): string[] {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(path.join(backendRoot, "medusa-config"));
    const config = loaded.default ?? loaded;
    const plugins: unknown[] = config?.plugins ?? [];
    return plugins
      .map((plugin) =>
        typeof plugin === "string" ? plugin : (plugin as { resolve?: string })?.resolve
      )
      .filter((name): name is string => typeof name === "string" && name !== "");
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  }
}

export function enumerateAdminRoutesReport({ backendRoot }: { backendRoot: string }): EnumerationReport {
  const manifest = JSON.parse(fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencyNames = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }).filter((name) => name.startsWith("@medusajs/") || name.startsWith("@gorgo/"));

  const pluginNames = readPluginNames(backendRoot);
  const packageNames = [...new Set([...dependencyNames, ...pluginNames])];

  const routes: EnumeratedRoute[] = [];
  const unresolved: string[] = [];
  const countsBySource: Record<string, number> = {};

  const own = collect(path.join(backendRoot, "src"), "app");
  routes.push(...own);
  countsBySource.app = own.length;

  for (const name of packageNames) {
    const directory = name.startsWith(".")
      ? path.resolve(backendRoot, name)
      : resolvePackageDirectory(name, backendRoot);
    if (!directory || !fs.existsSync(directory)) {
      unresolved.push(name);
      continue;
    }
    const found = collect(directory, name);
    routes.push(...found);
    countsBySource[name] = found.length;
  }

  return { routes, countsBySource, unresolved, pluginNames };
}

export function enumerateAdminRoutes(options: { backendRoot: string }): EnumeratedRoute[] {
  return enumerateAdminRoutesReport(options).routes;
}
