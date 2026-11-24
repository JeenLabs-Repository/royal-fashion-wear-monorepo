import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Fails when a NEXT_PUBLIC variable name looks like a secret. Everything under
// a NEXT_PUBLIC name is inlined into the browser bundle, so a key, token or
// password must never carry that prefix. Publishable keys are meant to be
// public and are allowed.

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js"];
const SKIPPED_DIRS = new Set(["node_modules", ".next"]);
const NAME_PATTERN = /NEXT_PUBLIC_[A-Z0-9_]+/g;
const SECRET_WORDS = ["SECRET", "PRIVATE", "PASSWORD", "TOKEN", "API_KEY"];

function parseRoot() {
  const flag = process.argv.indexOf("--root");
  if (flag !== -1 && process.argv[flag + 1]) {
    return path.resolve(process.argv[flag + 1]);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function collectFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, files);
    } else if (
      SOURCE_EXTENSIONS.includes(path.extname(entry.name)) ||
      entry.name === ".env.template"
    ) {
      files.push(full);
    }
  }
  return files;
}

function looksSecret(name) {
  if (name.includes("PUBLISHABLE")) return false;
  return SECRET_WORDS.some((word) => name.includes(word));
}

const root = parseRoot();
const storefront = path.join(root, "apps", "storefront");
const files = collectFiles(storefront);
const failures = [];

for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const name of line.match(NAME_PATTERN) ?? []) {
      if (looksSecret(name)) {
        const relative = path.relative(root, file).split(path.sep).join("/");
        failures.push(`${relative}:${index + 1}: ${name}`);
      }
    }
  });
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[FAIL] secret-looking public variable at ${failure}`);
  }
  process.exit(1);
}

console.log(
  `[PASS] public environment names: ${files.length} files scanned, none look like secrets`,
);
