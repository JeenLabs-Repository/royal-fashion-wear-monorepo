// Fails the build when a vendor-side module declares a tax, bank or identity
// column. Reads text only, never imports TypeScript.
//
// Usage:
//   node scripts/check-vendor-schema.mjs             run the self-test, then scan the repository
//   node scripts/check-vendor-schema.mjs --root DIR  scan a directory only (no self-test)
//   node scripts/check-vendor-schema.mjs --self-test run the self-test only
//
// Scanned modules apply the forbidden pattern to every model property and every
// column in a migration. The `documents` module is not scanned for the pattern
// (the owner's own tax id lives in invoice snapshots); it may only use column
// names listed in the config allowlist, plus the four standard columns.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptsDir, "..");
const config = JSON.parse(
  readFileSync(path.join(scriptsDir, "vendor-schema-config.json"), "utf8")
);

const STANDARD_COLUMNS = new Set(["id", "created_at", "updated_at", "deleted_at"]);
const SQL_TYPES =
  "text|varchar|int|integer|bigint|numeric|real|jsonb|boolean|timestamptz|date|serial";
// A model property: a line that starts with `name: model`.
const MODEL_PROPERTY = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*model\b/;
// A migration column: a quoted name followed by a SQL type.
const MIGRATION_COLUMN = new RegExp(`"([A-Za-z0-9_]+)"\\s+(?:${SQL_TYPES})\\b`, "g");

const tsFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
        .map((entry) => path.join(dir, entry.name))
    : [];

const collect = (moduleDir) => {
  const found = [];
  for (const file of tsFiles(path.join(moduleDir, "models"))) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const match = MODEL_PROPERTY.exec(line);
        if (match) {
          found.push({ file, line: index + 1, name: match[1] });
        }
      });
  }
  for (const file of tsFiles(path.join(moduleDir, "migrations"))) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const match of line.matchAll(MIGRATION_COLUMN)) {
          found.push({ file, line: index + 1, name: match[1] });
        }
      });
  }
  return found;
};

// Config keys are Medusa module names (camelCase). Directories follow the
// repo style (kebab-case), so vendorCatalog resolves to vendor-catalog.
const resolveModuleDir = (modulesDir, name) => {
  const exact = path.join(modulesDir, name);
  if (existsSync(exact)) {
    return exact;
  }
  const kebab = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  if (kebab !== name) {
    const kebabDir = path.join(modulesDir, kebab);
    if (existsSync(kebabDir)) {
      return kebabDir;
    }
  }
  return null;
};

export const scan = (root, cfg = config) => {
  const pattern = new RegExp(cfg.pattern, "i");
  const modulesDir = path.join(root, "apps", "backend", "src", "modules");
  const result = { scanned: [], missing: [], hits: [] };

  for (const name of cfg.scan) {
    const dir = resolveModuleDir(modulesDir, name);
    if (!dir) {
      if (cfg.required.includes(name)) {
        result.missing.push(name);
      }
      continue;
    }
    result.scanned.push(name);
    for (const column of collect(dir)) {
      if (pattern.test(column.name)) {
        result.hits.push({ ...column, rule: "matches the forbidden pattern" });
      }
    }
  }

  const documentsDir = path.join(modulesDir, "documents");
  if (existsSync(documentsDir)) {
    result.scanned.push("documents");
    const allowed = new Set(cfg.allowlist?.documents?.columns ?? []);
    for (const column of collect(documentsDir)) {
      if (!STANDARD_COLUMNS.has(column.name) && !allowed.has(column.name)) {
        result.hits.push({ ...column, rule: "is not on the documents allowlist" });
      }
    }
  }
  return result;
};

const report = (result, root) => {
  for (const hit of result.hits) {
    const relative = path.relative(root, hit.file).split(path.sep).join("/");
    console.error(`${relative}:${hit.line}: column "${hit.name}" ${hit.rule}`);
  }
  for (const name of result.missing) {
    console.error(
      `[check-vendor-schema] required module "${name}" is missing under apps/backend/src/modules`
    );
  }
  console.log(`[check-vendor-schema] scanned: ${result.scanned.join(",") || "none"}`);
  return result.hits.length === 0 && result.missing.length === 0;
};

// ---- self-test ----

const modelFile = (props) =>
  [
    'import { model } from "@medusajs/framework/utils";',
    'export const Sample = model.define("sample", {',
    "  id: model.id().primaryKey(),",
    ...props.map((name) => `  ${name}: model.text(),`),
    "});",
    "",
  ].join("\n");

const migrationFile = (columns) =>
  `this.addSql(\`create table "sample" ("id" text not null, ${columns
    .map((name) => `"${name}" text null`)
    .join(", ")}, "created_at" timestamptz not null default now());\`);\n`;

const write = (root, relative, content) => {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

const cleanVendor = (root) =>
  write(root, "apps/backend/src/modules/vendor/models/ok.ts", modelFile(["internal_name"]));

const selfTestCases = [
  { name: "a clean vendor module passes", expectFail: false, build: (r) => cleanVendor(r) },
  {
    name: "company and panel pass (no match at a word boundary)",
    expectFail: false,
    build: (r) =>
      write(r, "apps/backend/src/modules/vendor/models/ok.ts", modelFile(["company", "panel"])),
  },
  ...["gstin", "pan_number", "bank_account_no", "ifsc_code", "kyc_status", "aadhaar", "upi_id", "gst_number", "bank_holiday_note"].map(
    (column) => ({
      name: `a model property named ${column} fails`,
      expectFail: true,
      build: (r) =>
        write(r, "apps/backend/src/modules/vendor/models/bad.ts", modelFile([column])),
    })
  ),
  {
    name: "a quoted migration column named pan fails",
    expectFail: true,
    build: (r) => {
      cleanVendor(r);
      write(r, "apps/backend/src/modules/vendor/migrations/Migration1.ts", migrationFile(["pan"]));
    },
  },
  {
    name: "a bad column in vendorCatalog fails",
    expectFail: true,
    build: (r) => {
      cleanVendor(r);
      write(r, "apps/backend/src/modules/vendorCatalog/models/bad.ts", modelFile(["gstin"]));
    },
  },
  {
    name: "a bad column under the kebab-case vendor-catalog directory fails",
    expectFail: true,
    build: (r) => {
      cleanVendor(r);
      write(r, "apps/backend/src/modules/vendor-catalog/models/bad.ts", modelFile(["gstin"]));
    },
  },
  {
    name: "an unlisted documents column fails",
    expectFail: true,
    build: (r) => {
      cleanVendor(r);
      write(r, "apps/backend/src/modules/documents/models/doc.ts", modelFile(["invoice_number"]));
    },
  },
  {
    name: "a listed documents column and the standard columns pass",
    expectFail: false,
    cfg: { ...config, allowlist: { documents: { columns: ["invoice_number"] } } },
    build: (r) => {
      cleanVendor(r);
      write(r, "apps/backend/src/modules/documents/models/doc.ts", modelFile(["invoice_number"]));
      write(r, "apps/backend/src/modules/documents/migrations/Migration1.ts", migrationFile(["invoice_number"]));
    },
  },
  {
    name: "a missing vendor module fails",
    expectFail: true,
    build: (r) => mkdirSync(path.join(r, "apps/backend/src/modules"), { recursive: true }),
  },
];

const runSelfTest = () => {
  let failed = 0;
  for (const testCase of selfTestCases) {
    const root = mkdtempSync(path.join(tmpdir(), "vendor-schema-"));
    try {
      testCase.build(root);
      const result = scan(root, testCase.cfg ?? config);
      const failedScan = result.hits.length > 0 || result.missing.length > 0;
      if (failedScan === testCase.expectFail) {
        console.log(`[PASS] ${testCase.name}`);
      } else {
        failed += 1;
        console.log(`[FAIL] ${testCase.name}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  return failed === 0;
};

// ---- entry ----

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");

if (args.includes("--self-test")) {
  process.exit(runSelfTest() ? 0 : 1);
}

if (rootIndex !== -1) {
  const root = args[rootIndex + 1];
  if (!root) {
    console.error("--root needs a directory");
    process.exit(2);
  }
  process.exit(report(scan(path.resolve(root)), path.resolve(root)) ? 0 : 1);
}

// Default run, used by the guard runner: prove the parser, then scan.
const selfTestOk = runSelfTest();
const scanOk = report(scan(defaultRoot), defaultRoot);
process.exit(selfTestOk && scanOk ? 0 : 1);
