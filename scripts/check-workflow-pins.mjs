// Checks every workflow file for supply-chain basics.
//   1. every third-party `uses:` ends with @ and a 40-character commit SHA
//   2. a top-level `permissions:` key exists
//   3. the privileged pull-request trigger is not used
//   4. setup-node reads the version from .nvmrc and has no literal version
// Usage: node scripts/check-workflow-pins.mjs [--root DIR]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root = path.resolve(rootIndex === -1 ? "." : (args[rootIndex + 1] ?? "."));
const workflowDir = path.join(root, ".github", "workflows");

const violations = [];

const files = existsSync(workflowDir)
  ? readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))
  : [];

for (const name of files) {
  const text = readFileSync(path.join(workflowDir, name), "utf8");
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)/);
    if (!match) return;
    const target = match[1].replace(/^["']|["']$/g, "");
    if (target.startsWith("./")) return;
    if (!/@[0-9a-f]{40}$/.test(target)) {
      violations.push(`${name}:${index + 1}: "${target}" is not pinned to a full commit SHA`);
    }
  });

  if (!/^permissions:/m.test(text)) {
    violations.push(`${name}: no top-level permissions key`);
  }

  if (/pull_request_target/.test(text)) {
    violations.push(`${name}: uses the privileged pull-request trigger`);
  }

  if (/actions\/setup-node@/.test(text)) {
    if (!/node-version-file:\s*\.nvmrc/.test(text)) {
      violations.push(`${name}: setup-node must set node-version-file: .nvmrc`);
    }
    if (/^\s*node-version:/m.test(text)) {
      violations.push(`${name}: setup-node must not set a literal node-version`);
    }
  }
}

if (violations.length > 0) {
  console.log(violations.join("\n"));
  process.exit(1);
}

console.log(`check-workflow-pins: ${files.length} workflow files checked`);
