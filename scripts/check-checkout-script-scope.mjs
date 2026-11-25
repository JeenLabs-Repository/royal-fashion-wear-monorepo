#!/usr/bin/env node
// Keeps the payment script and gateway secrets out of the wrong places.
// Usage: node scripts/check-checkout-script-scope.mjs [--root <dir>]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root = path.resolve(
  rootIndex >= 0 && args[rootIndex + 1]
    ? args[rootIndex + 1]
    : path.join(scriptDir, ".."),
);

const STOREFRONT = "apps/storefront";
const SRC = `${STOREFRONT}/src`;
const LOADER = `${SRC}/lib/util/razorpay-checkout.ts`;
const CHECKOUT_MODULES = `${SRC}/modules/checkout/`;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".medusa", "dist"]);
const SOURCE_FILE = /\.(tsx?|jsx?|mjs|cjs|json)$/;
const CONFIG_FILE =
  /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|\.env[^/]*|[^/]+\.ya?ml|[^/]+\.template)$/;
const MAX_BYTES = 1024 * 1024;

const rel = (file) => path.relative(root, file).split(path.sep).join("/");

function walk(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const full = path.join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      files.push(...walk(full));
    } else if (info.size <= MAX_BYTES) {
      files.push(full);
    }
  }
  return files;
}

const read = (file) => readFileSync(file, "utf8");

const srcFiles = walk(path.join(root, SRC)).filter((f) => SOURCE_FILE.test(f));

// Files that may carry a public variable name: the storefront tree, deploy
// files, workflows and any compose or Docker file at the repository root.
const configRoots = [
  path.join(root, STOREFRONT),
  path.join(root, "deploy"),
  path.join(root, ".github"),
  path.join(root, "docker"),
];
const rootLevel = existsSync(root)
  ? readdirSync(root)
      .map((name) => path.join(root, name))
      .filter((full) => statSync(full).isFile())
  : [];
const configFiles = [
  ...configRoots.flatMap((dir) => walk(dir)),
  ...rootLevel,
].filter((f) => SOURCE_FILE.test(f) || CONFIG_FILE.test(rel(f)));

const results = [];

function check(name, violations) {
  results.push({ name, violations });
}

// 1. The script address lives in the loader only.
check(
  "script address appears only in the loader",
  srcFiles
    .filter((f) => rel(f) !== LOADER && read(f).includes("checkout.razorpay.com"))
    .map((f) => rel(f)),
);

// 2. Only checkout modules import the loader.
const IMPORTS_LOADER =
  /(from\s+["'][^"']*razorpay-checkout["'])|(import\(\s*["'][^"']*razorpay-checkout["']\s*\))/;
check(
  "loader is imported from checkout modules only",
  srcFiles
    .filter(
      (f) =>
        rel(f) !== LOADER &&
        IMPORTS_LOADER.test(read(f)) &&
        !rel(f).startsWith(CHECKOUT_MODULES),
    )
    .map((f) => rel(f)),
);

// 3. No public variable names a gateway key, secret or webhook.
const PUBLIC_GATEWAY_NAME = /NEXT_PUBLIC_[A-Z0-9_]*(RAZORPAY|KEY_SECRET|WEBHOOK)/;
check(
  "no public variable names a gateway value",
  configFiles
    .filter((f) => PUBLIC_GATEWAY_NAME.test(read(f)))
    .map((f) => rel(f)),
);

// 4. The storefront source never mentions the secrets themselves.
const SECRET_WORDS = /key_secret|webhook_secret/i;
check(
  "storefront source never names a gateway secret",
  srcFiles.filter((f) => SECRET_WORDS.test(read(f))).map((f) => rel(f)),
);

let failed = false;
for (const { name, violations } of results) {
  if (violations.length === 0) {
    console.log(`[PASS] ${name}`);
  } else {
    failed = true;
    console.log(`[FAIL] ${name}`);
    for (const file of violations) {
      console.log(`       ${file}`);
    }
  }
}

process.exit(failed ? 1 : 0);
