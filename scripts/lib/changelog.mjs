// Changelog building blocks. No file or git access in this module.

const sectionOrder = [
  ["breaking", "Breaking Changes"],
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["revert", "Reverts"],
  ["docs", "Documentation"],
  ["build", "Build and CI"],
  ["other", "Other"],
];

const sectionForType = {
  feat: "feat",
  fix: "fix",
  perf: "perf",
  revert: "revert",
  docs: "docs",
  build: "build",
  ci: "build",
  refactor: "other",
  test: "other",
  style: "other",
  chore: "other",
};

export function parseCommit(subject, body = "") {
  const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?: (.+)$/.exec(subject.trim());
  if (!match) return null;
  const [, type, scope, bang, text] = match;
  if (!(type in sectionForType)) return null;
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body);
  return { type, scope: scope ?? null, subject: text, breaking };
}

function line(commit) {
  const label = commit.scope ? `**${commit.scope}:** ` : "";
  return `- ${label}${commit.subject} (${commit.sha})`;
}

export function renderSection({ version, date, commits }) {
  const grouped = new Map(sectionOrder.map(([key]) => [key, []]));
  for (const commit of commits) {
    const key = commit.breaking ? "breaking" : sectionForType[commit.type];
    grouped.get(key).push(commit);
  }

  const parts = [`## ${version} (${date})`];
  for (const [key, title] of sectionOrder) {
    const entries = grouped.get(key);
    if (entries.length === 0) continue;
    parts.push(`### ${title}\n\n${entries.map(line).join("\n")}`);
  }
  return `${parts.join("\n\n")}\n`;
}

export function prependSection(existing, section) {
  const title = "# Changelog";
  const text = (existing ?? "").trim();
  if (text === "") return `${title}\n\n${section.trim()}\n`;
  if (!text.startsWith(title)) {
    throw new Error(`CHANGELOG.md must start with "${title}".`);
  }
  const rest = text.slice(title.length).trim();
  return rest === ""
    ? `${title}\n\n${section.trim()}\n`
    : `${title}\n\n${section.trim()}\n\n${rest}\n`;
}

export function assertVersionAbsent(text, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^## ${escaped}( |$)`, "m").test(text)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  }
}
