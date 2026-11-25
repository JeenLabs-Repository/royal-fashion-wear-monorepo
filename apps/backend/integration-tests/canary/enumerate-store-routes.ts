import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type StoreRoute = { pattern: string; source: "core" | "project" };

const corePackageDir = (): string => {
  try {
    return path.dirname(require.resolve("@medusajs/medusa/package.json"));
  } catch {
    const main = require.resolve("@medusajs/medusa");
    const marker = `${path.sep}@medusajs${path.sep}medusa${path.sep}`;
    const index = main.indexOf(marker);
    if (index < 0) {
      throw new Error("Could not locate the installed @medusajs/medusa package.");
    }
    return main.slice(0, index + marker.length - 1);
  }
};

const walkRoutes = (dir: string, fileName: string): string[] => {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return walkRoutes(full, fileName);
    }
    return name === fileName ? [full] : [];
  });
};

const toPattern = (root: string, file: string): string => {
  const relative = path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean);
  const segments = relative.map((segment) => segment.replace(/^\[(.+)\]$/, ":$1"));
  return `/store${segments.length > 0 ? `/${segments.join("/")}` : ""}`;
};

const COMPILED_GET = /exports\.GET\s*=|exports\["GET"\]|defineProperty\(exports,\s*["']GET["']/;
const SOURCE_GET = /export\s+(?:async\s+function|function|const)\s+GET\b/;

// Every GET route of the installed Store API plus the project's own store routes.
export const enumerateStoreRoutes = (): StoreRoute[] => {
  const routes = new Map<string, StoreRoute>();

  const coreRoot = path.join(corePackageDir(), "dist", "api", "store");
  for (const file of walkRoutes(coreRoot, "route.js")) {
    if (COMPILED_GET.test(readFileSync(file, "utf8"))) {
      routes.set(toPattern(coreRoot, file), { pattern: toPattern(coreRoot, file), source: "core" });
    }
  }

  const projectRoot = path.resolve(__dirname, "..", "..", "src", "api", "store");
  for (const file of walkRoutes(projectRoot, "route.ts")) {
    if (SOURCE_GET.test(readFileSync(file, "utf8"))) {
      const pattern = toPattern(projectRoot, file);
      routes.set(pattern, { pattern, source: "project" });
    }
  }

  return [...routes.values()].sort((a, b) => a.pattern.localeCompare(b.pattern));
};
