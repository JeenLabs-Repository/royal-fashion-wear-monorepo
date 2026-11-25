#!/usr/bin/env node
// Fails when a removed payment provider returns to the storefront or its
// workflows. India has one gateway; every other provider name, package or
// variable is dead code that adds supply-chain and configuration risk.
//
// Usage: node scripts/check-no-stripe.mjs [--root <dir>]
// Output: [PASS] lines, or [FAIL] <path>:<line> <name> lines and exit code 1.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

const NAMES = [
  "stripe",
  "paypal",
  "pp_medusa",
  "pp_system",
  "MEDUSA_PAYMENTS",
  "@stripe/",
];

// Paths below the root that must stay free of the names above.
const SCAN_ROOTS = ["apps/storefront", ".github/workflows"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", ".git", "coverage"]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
  ".template",
  ".css",
  ".html",
  ".txt",
  ".sh",
]);

const parseRoot = (argv) => {
  const at = argv.indexOf("--root");
  if (at === -1) {
    return resolve(import.meta.dirname, "..");
  }
  const value = argv[at + 1];
  if (!value) {
    console.error("[FAIL] --root needs a directory");
    process.exit(2);
  }
  return resolve(value);
};

const isTextFile = (path) => {
  const name = basename(path);
  if (SKIP_FILES.has(name)) {
    return false;
  }
  return (
    TEXT_EXTENSIONS.has(extname(name).toLowerCase()) ||
    name.startsWith("Dockerfile") ||
    name === ".env.template" ||
    name === ".env.example"
  );
};

const walk = (dir, out) => {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        walk(full, out);
      }
    } else if (info.isFile() && isTextFile(full)) {
      out.push(full);
    }
  }
};

// Prefer tracked files so ignored local env files never trip the guard.
const listTracked = (root, scanRoot) => {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "ls-files", "-z", "--", scanRoot],
      { encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((relPath) => join(root, relPath))
      .filter((full) => existsSync(full) && isTextFile(full));
  } catch {
    return null;
  }
};

const root = parseRoot(process.argv.slice(2));
const files = [];
for (const scanRoot of SCAN_ROOTS) {
  const tracked = listTracked(root, scanRoot);
  if (tracked) {
    files.push(...tracked);
  } else {
    walk(join(root, scanRoot), files);
  }
}

const needles = NAMES.map((name) => ({ name, lower: name.toLowerCase() }));
const hits = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    for (const needle of needles) {
      if (lower.includes(needle.lower)) {
        const shown = relative(root, file).split("\\").join("/");
        hits.push(`${shown}:${index + 1} ${needle.name}`);
        break;
      }
    }
  });
}

if (hits.length > 0) {
  for (const hit of hits) {
    console.error(`[FAIL] ${hit}`);
  }
  console.error(`[FAIL] ${hits.length} removed payment provider reference(s) found`);
  process.exit(1);
}

console.log(`[PASS] no removed payment provider names in ${files.length} scanned files`);
