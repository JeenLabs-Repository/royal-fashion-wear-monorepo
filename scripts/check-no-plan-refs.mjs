// Fails when tracked text mentions planning identifiers (requirement ids,
// decision ids, phase or plan numbers). The planning documents are not part
// of this repository, so such references would point at nothing.
//
// Usage:
//   node scripts/check-no-plan-refs.mjs             scan git ls-files
//   node scripts/check-no-plan-refs.mjs --root DIR  scan a directory instead
//   node scripts/check-no-plan-refs.mjs --stdin     check text from stdin
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const patterns = [
  {
    name: "requirement id",
    re: /\b(OPS|CUT|REPO|GOV|VEND|CAT|ROUT|DOC|IND|INT|RET|TEST|NOTF|COMP)-\d{2}\b/,
  },
  { name: "decision id", re: /\bD-\d{2}\b/ },
  { name: "phase or plan number", re: /\b[Pp](?:hase|lan)[ -]\d/ },
];

// Files that quote bad examples on purpose.
const quotingFiles = new Set([
  "CLAUDE.md",
  "commitlint.config.cjs",
  "scripts/check-commit-rules.mjs",
  "scripts/check-no-plan-refs.mjs",
  "scripts/check-branch-name.mjs",
  "scripts/check-doc-consistency.mjs",
]);
const quotingPrefixes = [".cursor/rules/", ".claude/skills/"];
const skippedFile =
  /(^|\/)pnpm-lock\.yaml$|\.(svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|pdf)$/i;
const generatedCatalog = /\/(messages|data)\/.*\.json$/;

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root = rootIndex === -1 ? null : path.resolve(args[rootIndex + 1] ?? "");

function scan(text, label) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { name, re } of patterns) {
      if (re.test(line)) {
        hits.push(`${label}:${index + 1}: ${line.trim()} [${name}]`);
        break;
      }
    }
  });
  return hits;
}

function isSkipped(relative) {
  return (
    quotingFiles.has(relative) ||
    quotingPrefixes.some((prefix) => relative.startsWith(prefix)) ||
    skippedFile.test(relative) ||
    generatedCatalog.test(`/${relative}`)
  );
}

function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full, base));
    } else {
      files.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return files;
}

let hits = [];

if (args.includes("--stdin")) {
  hits = scan(readFileSync(0, "utf8"), "stdin");
} else {
  const base = root ?? process.cwd();
  const files =
    root === null
      ? execFileSync("git", ["ls-files"], { encoding: "utf8" })
          .split("\n")
          .filter(Boolean)
      : walk(root);

  for (const relative of files) {
    if (isSkipped(relative)) continue;
    const full = path.join(base, relative);
    if (!existsSync(full)) continue;
    const buffer = readFileSync(full);
    if (buffer.includes(0)) continue; // binary
    hits.push(...scan(buffer.toString("utf8"), relative));
  }
}

if (hits.length > 0) {
  console.log(hits.join("\n"));
  console.log(`check-no-plan-refs: ${hits.length} hits`);
  process.exit(1);
}

console.log("check-no-plan-refs: 0 hits");
