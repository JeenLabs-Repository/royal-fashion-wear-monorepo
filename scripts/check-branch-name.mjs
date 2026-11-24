// Rejects branch names that carry planning numbers or tool prefixes.
// With an argument it checks that name. Without one it runs its own cases.
// Usage: node scripts/check-branch-name.mjs [branch-name]
const longLived = new Set(["main", "dev", "active-dev"]);

const rules = [
  {
    name: "tool prefix",
    re: /^gsd\//i,
  },
  {
    name: "phase, plan, task or wave number",
    re: /(^|[/_-])(phase|plan|task|wave)[-_]?\d+/i,
  },
  {
    name: "requirement id",
    re: /(^|[/_-])(ops|cut|repo|gov|vend|cat|rout|doc|ind|int|ret|test|notf|comp)-\d{1,3}($|[/_-])/i,
  },
  {
    name: "decision id",
    re: /(^|[/_-])d-\d{2}($|[/_-])/i,
  },
];

const shape = /^[a-z][a-z0-9]*\/[a-z0-9]+(-[a-z0-9]+)*$/;

export function problem(name) {
  if (longLived.has(name)) return null;
  for (const { name: ruleName, re } of rules) {
    if (re.test(name)) return ruleName;
  }
  if (!shape.test(name)) return "name must look like type/kebab-description";
  return null;
}

const argument = process.argv[2];

if (argument !== undefined) {
  const found = problem(argument);
  if (found) {
    console.error(`Branch name "${argument}" refused: ${found}`);
    process.exit(1);
  }
  process.exit(0);
}

const cases = [
  { name: "main", ok: true },
  { name: "dev", ok: true },
  { name: "active-dev", ok: true },
  { name: "feat/vendor-invites", ok: true },
  { name: "fix/cart-cache-leak", ok: true },
  { name: "docs/explain-routing-flow", ok: true },
  { name: "gsd/phase-1-baseline", ok: false },
  { name: "gsd/vendor-invites", ok: false },
  { name: "feat/task-4-vendor-api", ok: false },
  { name: "feat/phase3", ok: false },
  { name: "fix/plan-2-cleanup", ok: false },
  { name: "feat/ops-01-pin-lookup", ok: false },
  { name: "docs/d-12-record", ok: false },
  { name: "vendor-stuff", ok: false },
];

let failed = 0;

for (const testCase of cases) {
  const accepted = problem(testCase.name) === null;
  if (accepted === testCase.ok) {
    console.log(`[PASS] ${testCase.name}`);
  } else {
    failed += 1;
    console.log(`[FAIL] ${testCase.name}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
