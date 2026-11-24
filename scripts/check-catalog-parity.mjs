import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keeps the locale list and the three catalog sets in step: the storefront UI
// catalogs, the email catalogs and the seed locale files. Each set must hold
// one file per locale in the list, and every file must have the same keys as
// its English file.

const CONFIG = "apps/storefront/src/i18n/config.ts";
const SETS = [
  { name: "storefront catalogs", dir: "apps/storefront/messages" },
  { name: "email catalogs", dir: "apps/backend/src/emails/i18n/messages" },
  {
    name: "seed locale files",
    dir: "apps/backend/src/migration-scripts/data/i18n/json",
  },
];

function parseRoot() {
  const flag = process.argv.indexOf("--root");
  if (flag !== -1 && process.argv[flag + 1]) {
    return path.resolve(process.argv[flag + 1]);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

const root = parseRoot();
let failed = false;

function report(ok, message) {
  if (ok) {
    console.log(`[PASS] ${message}`);
  } else {
    failed = true;
    console.error(`[FAIL] ${message}`);
  }
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function flatten(value, prefix = "") {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const configPath = path.join(root, CONFIG);
if (!fs.existsSync(configPath)) {
  console.error(`[FAIL] cannot read ${CONFIG} under ${root}`);
  process.exit(1);
}
const config = fs.readFileSync(configPath, "utf8");

const localesBody = config.match(/export const locales = \[([\s\S]*?)\]\s*as const/);
const codes = localesBody
  ? [...localesBody[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
  : [];
report(codes.length > 0, `locale list found in config (${codes.join(", ") || "none"})`);

const labelsBody = config.match(/export const localeLabels[^=]*=\s*\{([\s\S]*?)\n\}/);
const labelKeys = labelsBody
  ? [...labelsBody[1].matchAll(/^\s*"?([A-Za-z-]+)"?:/gm)].map((match) => match[1])
  : [];
const missingLabels = difference(codes, labelKeys);
const extraLabels = difference(labelKeys, codes);
report(
  missingLabels.length === 0 && extraLabels.length === 0,
  `language labels match the locale list (missing: ${missingLabels.join(", ") || "none"}; extra: ${extraLabels.join(", ") || "none"})`,
);

const storefrontEnglish = path.join(root, SETS[0].dir, "en.json");
if (fs.existsSync(storefrontEnglish)) {
  const listed = Object.keys(readJson(storefrontEnglish).LanguageSelect?.locales ?? {});
  const missing = difference(codes, listed);
  const extra = difference(listed, codes);
  report(
    missing.length === 0 && extra.length === 0,
    `LanguageSelect.locales matches the locale list (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`,
  );
} else {
  report(false, `${SETS[0].dir}/en.json is missing`);
}

for (const set of SETS) {
  const dir = path.join(root, set.dir);
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((file) => file.endsWith(".json")).sort()
    : [];
  const expected = codes.map((code) => `${code}.json`);
  const missingFiles = difference(expected, files);
  const extraFiles = difference(files, expected);
  report(
    missingFiles.length === 0 && extraFiles.length === 0,
    `${set.name} match the locale list (missing files: ${missingFiles.join(", ") || "none"}; extra files: ${extraFiles.join(", ") || "none"})`,
  );

  if (!files.includes("en.json")) {
    report(false, `${set.name} have no en.json to compare keys against`);
    continue;
  }
  const reference = flatten(readJson(path.join(dir, "en.json")));
  const problems = [];
  for (const file of files) {
    if (file === "en.json") continue;
    const keys = flatten(readJson(path.join(dir, file)));
    const missing = difference(reference, keys);
    const extra = difference(keys, reference);
    if (missing.length || extra.length) {
      problems.push(`${file} (missing ${missing.length}, extra ${extra.length})`);
    }
  }
  report(
    problems.length === 0,
    `${set.name} have the same keys as en.json${problems.length ? `: ${problems.join("; ")}` : ""}`,
  );
}

process.exit(failed ? 1 : 0);
