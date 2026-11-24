// Runs every scripts/check-*.mjs guard and fails if any of them fails.
// Add a guard by dropping a new check-*.mjs file next to this one.
// Usage: node scripts/run-guards.mjs [--only <substring>]
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const only = onlyIndex === -1 ? "" : (args[onlyIndex + 1] ?? "");

if (onlyIndex !== -1 && only === "") {
  console.error("--only needs a value");
  process.exit(2);
}

const guards = readdirSync(scriptsDir)
  .filter((file) => /^check-.*\.mjs$/.test(file))
  .filter((file) => file.includes(only))
  .sort();

// A runner that ran nothing must not look like a pass.
if (guards.length === 0) {
  console.error(`No guard matches "${only}".`);
  process.exit(1);
}

let failed = 0;

for (const file of guards) {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, file)], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status === 0) {
    console.log(`[PASS] ${file}`);
  } else {
    failed += 1;
    console.log(`[FAIL] ${file}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
