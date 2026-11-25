import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Fails when the storefront state list and the backend state table disagree in
// any code or name, in either direction, or when either does not hold exactly
// 36 entries. The two files cannot import each other, so this guard is the
// only thing keeping them equal. The backend table lives in states-data.json
// (imported by states.ts).

const EXPECTED_COUNT = 36;
const BACKEND_FILE = [
  "apps",
  "backend",
  "src",
  "lib",
  "geo-india",
  "states-data.json",
];
const STOREFRONT_FILE = [
  "apps",
  "storefront",
  "src",
  "lib",
  "util",
  "india-states.ts",
];

const STOREFRONT_ENTRY =
  /value:\s*"(in-[a-z]{2,3})"\s*,\s*label:\s*"([^"]+)"\s*,\s*code:\s*"(IN-[A-Z]{2,3})"/g;

function parseRoot() {
  const flag = process.argv.indexOf("--root");
  if (flag !== -1 && process.argv[flag + 1]) {
    return path.resolve(process.argv[flag + 1]);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function readSource(root, parts, failures) {
  const file = path.join(root, ...parts);
  if (!fs.existsSync(file)) {
    failures.push(`missing file ${parts.join("/")}`);
    return null;
  }
  return fs.readFileSync(file, "utf8");
}

function main() {
  const root = parseRoot();
  const failures = [];
  const backend = new Map();
  const storefront = new Map();

  const backendText = readSource(root, BACKEND_FILE, failures);
  const storefrontText = readSource(root, STOREFRONT_FILE, failures);

  if (backendText) {
    let rows;
    try {
      rows = JSON.parse(backendText);
    } catch (error) {
      failures.push(`backend table is not valid JSON: ${error.message}`);
      rows = null;
    }
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (
          row &&
          typeof row.code === "string" &&
          typeof row.name === "string"
        ) {
          backend.set(row.code, row.name);
        }
      }
    } else if (rows !== null) {
      failures.push("backend table must be a JSON array");
    }
  }

  if (storefrontText) {
    for (const match of storefrontText.matchAll(STOREFRONT_ENTRY)) {
      if (match[1] !== match[3].toLowerCase()) {
        failures.push(`value ${match[1]} does not match code ${match[3]}`);
      }
      storefront.set(match[3], match[2]);
    }
  }

  if (backendText && backend.size !== EXPECTED_COUNT) {
    failures.push(
      `backend table has ${backend.size} entries, expected ${EXPECTED_COUNT}`,
    );
  }
  if (storefrontText && storefront.size !== EXPECTED_COUNT) {
    failures.push(
      `storefront list has ${storefront.size} entries, expected ${EXPECTED_COUNT}`,
    );
  }

  if (backendText && storefrontText) {
    for (const [code, name] of backend) {
      if (!storefront.has(code)) {
        failures.push(`storefront list lacks ${code} (${name})`);
      } else if (storefront.get(code) !== name) {
        failures.push(
          `name differs for ${code}: backend "${name}", storefront "${storefront.get(code)}"`,
        );
      }
    }
    for (const code of storefront.keys()) {
      if (!backend.has(code)) {
        failures.push(
          `storefront list has ${code}, which the backend table lacks`,
        );
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[FAIL] state list parity: ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `[PASS] state list parity: ${storefront.size} states match the backend table`,
  );
}

main();
