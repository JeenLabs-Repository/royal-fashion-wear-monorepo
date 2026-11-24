// Accept and reject cases for the commit message rules.
// Each message is piped to commitlint on stdin; no commit is ever created.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const cases = [
  { name: "accept: plain build message", msg: "build: pin medusa packages to 2.22.7", ok: true },
  {
    name: "accept: scoped fix",
    msg: "fix(storefront): stop caching authenticated cart requests",
    ok: true,
  },
  { name: "reject: plan numbering in scope", msg: "feat(1-0): vendor stuff", ok: false },
  { name: "reject: phase numbering", msg: "chore: finish phase 3 cleanup", ok: false },
  // Lower case on purpose: the subject-case rule alone would reject capitals,
  // so only the numbering rule can reject these.
  { name: "reject: requirement id", msg: "feat: add pin lookup for ops-01", ok: false },
  { name: "reject: decision id", msg: "docs: record d-12 decision", ok: false },
  { name: "reject: no type", msg: "wip", ok: false },
  { name: "reject: subject not lower case", msg: "feat: Add Vendor Invite Route", ok: false },
  {
    name: "reject: numbering in the body",
    msg: "feat: add vendor invite route\n\nThis finishes task 4 of the work.",
    ok: false,
  },
];

let failed = 0;

for (const testCase of cases) {
  const result = spawnSync("pnpm", ["exec", "commitlint"], {
    cwd: root,
    input: `${testCase.msg}\n`,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const accepted = result.status === 0;
  if (accepted === testCase.ok) {
    console.log(`[PASS] ${testCase.name}`);
  } else {
    failed += 1;
    console.log(`[FAIL] ${testCase.name} (commitlint exit ${result.status})`);
  }
}

process.exit(failed === 0 ? 0 : 1);
