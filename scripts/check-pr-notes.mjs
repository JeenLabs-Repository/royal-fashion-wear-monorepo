// Checks that a pull request body fills the nine required sections and
// mentions no planning numbers. The body comes from the PR_BODY variable.
// Usage:
//   node scripts/check-pr-notes.mjs               check PR_BODY (or self-test when unset)
//   node scripts/check-pr-notes.mjs --self-test   run the built-in cases
// Set REQUIRE_PR_BODY=1 (CI does) to make an empty body a failure.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

const requiredHeadings = [
  "Summary",
  "Backend changes",
  "Storefront changes",
  "How it was tested",
  "Migrations",
  "New or changed environment variables and secrets",
  "Rollback plan",
  "Known risks",
  "Screenshots",
];

function sectionsOf(body) {
  const text = body.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const sections = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      sections.set(current, "");
    } else if (current !== null) {
      sections.set(current, `${sections.get(current)}${line}\n`);
    }
  }
  return sections;
}

export function checkBody(body) {
  const problems = [];
  const sections = sectionsOf(body);

  for (const heading of requiredHeadings) {
    if (!sections.has(heading)) {
      problems.push(`missing section "${heading}"`);
    } else if (sections.get(heading).trim() === "") {
      problems.push(`section "${heading}" has no text`);
    }
  }

  const refs = spawnSync(process.execPath, [path.join(scriptsDir, "check-no-plan-refs.mjs"), "--stdin"], {
    cwd: repoRoot,
    input: body,
    encoding: "utf8",
  });
  if (refs.status !== 0) {
    problems.push(`planning numbers found: ${refs.stdout.trim().split("\n")[0]}`);
  }

  return problems;
}

function fullBody(replace = {}) {
  return requiredHeadings
    .map((heading) => `## ${heading}\n\n${replace[heading] ?? "None."}\n`)
    .join("\n");
}

function selfTest() {
  // Identifiers are assembled at run time so this file holds no literal ones.
  const requirementId = ["REPO", "01"].join("-");
  const phaseText = ["phase", "3"].join(" ");

  const cases = [
    { name: "complete body passes", body: fullBody(), ok: true },
    {
      name: "missing heading fails",
      body: fullBody().replace("## Known risks\n\nNone.\n", ""),
      ok: false,
    },
    { name: "whitespace-only section fails", body: fullBody({ Migrations: "   " }), ok: false },
    {
      name: "comment-only section fails",
      body: fullBody({ Screenshots: "<!-- add screenshots -->" }),
      ok: false,
    },
    {
      name: "requirement id fails",
      body: fullBody({ Summary: `Finishes ${requirementId}.` }),
      ok: false,
    },
    { name: "phase number fails", body: fullBody({ "Known risks": `See ${phaseText}.` }), ok: false },
    { name: "windows line endings pass", body: fullBody().replace(/\n/g, "\r\n"), ok: true },
  ];

  let failed = 0;
  for (const testCase of cases) {
    const accepted = checkBody(testCase.body).length === 0;
    if (accepted === testCase.ok) {
      console.log(`[PASS] ${testCase.name}`);
    } else {
      failed += 1;
      console.log(`[FAIL] ${testCase.name}`);
    }
  }
  return failed === 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
  }

  const body = process.env.PR_BODY;

  if (body === undefined || body.trim() === "") {
    if (process.env.REQUIRE_PR_BODY === "1") {
      console.log("The pull request body is empty. Fill every section of the template.");
      process.exit(1);
    }
    const ok = selfTest();
    console.log("check-pr-notes: PR_BODY not set, pull request check skipped");
    process.exit(ok ? 0 : 1);
  }

  const problems = checkBody(body);
  if (problems.length > 0) {
    console.log(problems.map((problem) => `- ${problem}`).join("\n"));
    process.exit(1);
  }
  console.log("check-pr-notes: all sections filled");
}
