#!/usr/bin/env node
// Guard: the protection script detects a plan that cannot enforce rules on the
// server, says so, and still applies the rulesets where the plan allows them.
// A stub GitHub CLI stands in for GitHub, so nothing leaves this machine.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "setup-branch-protection.sh");
const work = mkdtempSync(join(tmpdir(), "protect-stub-"));
const stub = join(work, "gh-stub.sh").replace(/\\/g, "/");

// STUB_MODE is free (rulesets read answers 403), paid (everything works) or broken (500).
writeFileSync(
  join(work, "gh-stub.sh"),
  `#!/bin/sh
args="$*"
case "$args" in
  "auth status") exit 0 ;;
  "api user --jq .plan.name") echo free; exit 0 ;;
  "api repos/o/r --jq .private") echo true; exit 0 ;;
  "api -X PATCH repos/o/r "*) exit 0 ;;
  "api repos/o/r/rulesets")
    if [ "$STUB_MODE" = "free" ]; then
      echo "gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)" >&2
      exit 1
    fi
    if [ "$STUB_MODE" = "broken" ]; then
      echo "gh: Server Error (HTTP 500)" >&2
      exit 1
    fi
    echo "[]"
    exit 0 ;;
  "api repos/o/r/rulesets --jq "*) exit 0 ;;
  "api -X POST repos/o/r/rulesets "*) exit 0 ;;
  "api repos/o/r/rules/branches/"*)
    printf 'deletion\\nnon_fast_forward\\nrequired_signatures\\npull_request\\nrequired_status_checks\\n'
    exit 0 ;;
esac
echo "stub gh: unexpected call: $args" >&2
exit 9
`,
);

const run = (mode) =>
  spawnSync("sh", [script, "o/r", "--yes"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GH_BIN: `sh ${stub}`, STUB_MODE: mode },
  });

const cases = [
  {
    name: "free plan prints the manual rules and says enforcement is local only",
    mode: "free",
    ok: (r) =>
      r.status === 0 &&
      r.stdout.includes("ENFORCEMENT: LOCAL ONLY") &&
      r.stdout.includes("ci-gate") &&
      r.stdout.includes("never push to main directly") &&
      !r.stdout.includes("Created ruleset"),
  },
  {
    name: "paid plan creates both rulesets and reads them back",
    mode: "paid",
    ok: (r) =>
      r.status === 0 &&
      r.stdout.includes("Created ruleset protect-main") &&
      r.stdout.includes("Created ruleset protect-dev") &&
      r.stdout.includes("ENFORCEMENT: SERVER") &&
      !r.stdout.includes("LOCAL ONLY"),
  },
  {
    name: "an unexpected API error stops the script",
    mode: "broken",
    ok: (r) => r.status === 1 && !r.stdout.includes("ENFORCEMENT"),
  },
];

let failed = false;
for (const { name, mode, ok } of cases) {
  const result = run(mode);
  if (ok(result)) {
    console.log(`[PASS] ${name}`);
  } else {
    failed = true;
    console.log(`[FAIL] ${name}`);
    console.log(result.stdout);
    console.log(result.stderr);
  }
}
rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
