// Cases for the changelog library. Uses inline fixtures: no git, no writes.
import {
  assertVersionAbsent,
  parseCommit,
  prependSection,
  renderSection,
} from "./lib/changelog.mjs";

let failed = 0;

function check(name, run) {
  try {
    const problem = run();
    if (problem) throw new Error(problem);
    console.log(`[PASS] ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`[FAIL] ${name}: ${error.message}`);
  }
}

const same = (actual, expected) =>
  JSON.stringify(actual) === JSON.stringify(expected)
    ? null
    : `expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`;

check("scoped feature is parsed", () =>
  same(parseCommit("feat(vendor-api): add invite route", ""), {
    type: "feat",
    scope: "vendor-api",
    subject: "add invite route",
    breaking: false,
  }),
);

check("bang marks a breaking change", () =>
  same(parseCommit("feat!: drop old route", "")?.breaking, true),
);

check("breaking footer marks a breaking change", () =>
  same(parseCommit("fix: change token format", "Details.\n\nBREAKING CHANGE: tokens differ")?.breaking, true),
);

check("non-conventional subject is skipped", () => same(parseCommit("Merge branch x", ""), null));

const commits = [
  { type: "docs", scope: null, subject: "explain routing", breaking: false, sha: "ccc3333" },
  { type: "fix", scope: "storefront", subject: "stop caching cart", breaking: false, sha: "bbb2222" },
  { type: "feat", scope: null, subject: "add invite route", breaking: false, sha: "aaa1111" },
  { type: "feat", scope: null, subject: "drop old route", breaking: true, sha: "ddd4444" },
];

check("sections are ordered and empty ones are omitted", () => {
  const text = renderSection({ version: "v0.1.0", date: "2026-01-02", commits });
  const order = ["### Breaking Changes", "### Features", "### Fixes", "### Documentation"].map((h) =>
    text.indexOf(h),
  );
  const sorted = [...order].sort((a, b) => a - b);
  if (order.includes(-1)) return "a section is missing";
  if (text.includes("### Performance")) return "an empty section was printed";
  return same(order, sorted);
});

check("heading and line formats", () => {
  const text = renderSection({ version: "v0.1.0", date: "2026-01-02", commits });
  if (!text.startsWith("## v0.1.0 (2026-01-02)\n")) return "bad heading";
  if (!text.includes("- **storefront:** stop caching cart (bbb2222)")) return "bad scoped line";
  if (!text.includes("- add invite route (aaa1111)")) return "bad plain line";
  return null;
});

check("prepend creates the file text and keeps older sections below", () => {
  const first = prependSection("", "## v0.1.0 (2026-01-02)\n\n- one (aaa1111)");
  if (!first.startsWith("# Changelog\n\n## v0.1.0")) return "title missing";
  const second = prependSection(first, "## v0.2.0 (2026-02-03)\n\n- two (bbb2222)");
  return second.indexOf("## v0.2.0") < second.indexOf("## v0.1.0") ? null : "new section is not first";
});

check("existing version is refused", () => {
  const text = "# Changelog\n\n## v0.1.0 (2026-01-02)\n\n- one (aaa1111)\n";
  try {
    assertVersionAbsent(text, "v0.1.0");
  } catch {
    assertVersionAbsent(text, "v0.2.0");
    return null;
  }
  return "did not throw";
});

process.exit(failed === 0 ? 0 : 1);
