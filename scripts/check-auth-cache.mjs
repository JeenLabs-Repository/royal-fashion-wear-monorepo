#!/usr/bin/env node
// Guard: nothing that carries a customer's credentials may use Next's shared
// fetch cache. The cache is keyed by URL and options, not by visitor, so one
// customer's response could be served to the next one.
//
// Rule 1: a "force-cache" literal whose fetch call sends the auth headers.
// Rule 2: the customer and variant loaders return before calling the backend
//         when there is no authorization header.
//
// Usage: node scripts/check-auth-cache.mjs [--count] [--root <dir>]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const countOnly = args.includes("--count");
const rootFlag = args.indexOf("--root");
const root =
  rootFlag !== -1 && args[rootFlag + 1]
    ? resolve(args[rootFlag + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_DIR = join(root, "apps", "storefront", "src");
const DATA_DIR = join(SOURCE_DIR, "lib", "data");

// Loaders that must answer null without a backend call for signed-out visitors.
const LOADERS_NEEDING_EARLY_RETURN = [
  { file: "customer.ts", name: "retrieveCustomer" },
  { file: "customer.ts", name: "retrieveCustomerAddresses" },
  { file: "variants.ts", name: "retrieveVariant" },
];

const sourceFiles = (dir) => {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") {
        found.push(...sourceFiles(full));
      }
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const shown = (file) => relative(root, file).split("\\").join("/");

const findings = [];

// Rule 1
for (const file of sourceFiles(SOURCE_DIR)) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/["']force-cache["']/g)) {
    const before = text.slice(0, match.index);
    const fetchStart = before.lastIndexOf(".fetch");
    if (fetchStart === -1) continue;
    const call = text.slice(fetchStart, match.index);
    const sendsCredentials =
      call.includes("getAuthHeaders") ||
      /authorization/i.test(call) ||
      /(^|\s)headers\s*,/m.test(call);
    if (sendsCredentials) {
      findings.push(`${shown(file)}:${lineOf(text, match.index)}: force-cache on a request that carries auth headers`);
    }
  }
}

// Rule 2
for (const { file, name } of LOADERS_NEEDING_EARLY_RETURN) {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    findings.push(`${shown(path)}:1: file not found, cannot check ${name}`);
    continue;
  }
  const text = readFileSync(path, "utf8");
  const start = text.search(new RegExp(`export (const|async function) ${name}\\b`));
  if (start === -1) {
    findings.push(`${shown(path)}:1: ${name} not found`);
    continue;
  }
  const fetchAt = text.indexOf(".fetch", start);
  const body = text.slice(start, fetchAt === -1 ? undefined : fetchAt);
  if (!body.includes('"authorization" in')) {
    findings.push(`${shown(path)}:${lineOf(text, start)}: ${name} has no early return for a missing authorization header`);
  }
}

if (countOnly) {
  console.log(findings.length);
} else if (findings.length === 0) {
  console.log("[PASS] no shared-cache request carries credentials");
} else {
  for (const finding of findings) console.log(`[FAIL] ${finding}`);
}
process.exit(findings.length === 0 ? 0 : 1);
