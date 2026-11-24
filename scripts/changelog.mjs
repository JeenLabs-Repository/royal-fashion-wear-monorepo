// Builds a changelog section from conventional commits and writes CHANGELOG.md.
// Usage: node scripts/changelog.mjs --version vX.Y.Z [--from <tag>] [--date YYYY-MM-DD]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  assertVersionAbsent,
  parseCommit,
  prependSection,
  renderSection,
} from "./lib/changelog.mjs";

const versionPattern = /^v(0\.[0-9]+\.[0-9]+|[1-9][0-9]*\.[0-9]+\.[0-9]+)$/;

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

const version = option("--version");
if (!version || !versionPattern.test(version)) {
  console.error("Pass --version vX.Y.Z (v0.x before launch, then v1.0.0 and up).");
  process.exit(1);
}

const date = option("--date") ?? new Date().toISOString().slice(0, 10);

let from = option("--from");
if (!from) {
  try {
    from = git("describe", "--tags", "--abbrev=0");
  } catch {
    from = null; // no tags yet: start from the first commit
  }
}

const range = from ? `${from}..HEAD` : "HEAD";
const raw = execFileSync(
  "git",
  ["log", range, "--no-merges", "--reverse", "--format=%H%x1f%s%x1f%b%x1e"],
  { encoding: "utf8" },
);

const commits = [];
for (const record of raw.split("\x1e")) {
  const [sha, subject, body] = record.replace(/^\n/, "").split("\x1f");
  if (!sha || !subject) continue;
  const parsed = parseCommit(subject, body ?? "");
  if (parsed) commits.push({ ...parsed, sha: sha.slice(0, 7) });
}

if (commits.length === 0) {
  console.error(`No conventional commits found in ${range}.`);
  process.exit(1);
}

const file = "CHANGELOG.md";
const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
assertVersionAbsent(existing, version);

const section = renderSection({ version, date, commits });
writeFileSync(file, prependSection(existing, section));
console.log(section);
