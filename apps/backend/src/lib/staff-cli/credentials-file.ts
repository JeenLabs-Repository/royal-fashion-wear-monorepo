import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MedusaError } from "@medusajs/framework/utils";

export const CREDENTIALS_FILE_NAME = "TEST-CREDENTIALS.local.md";
export const STAFF_DEMO_START = "<!-- staff-demo:start -->";
export const STAFF_DEMO_END = "<!-- staff-demo:end -->";

const TEMPLATE_PATH = path.join("docs", "testing", "test-credentials.template.md");
const SEED_END = "<!-- seed:end -->";
const ACCOUNTS_HEADING = "## Accounts by role";
const NOT_RECOVERABLE = "existing account, password not recoverable";

export type CredentialRow = {
  role: string;
  email: string;
  /** Null when the account already existed and this run does not know its password */
  password: string | null;
  createdBy: string;
  reset: string;
};

export const findRepoRoot = (start: string = process.cwd()): string => {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Could not find pnpm-workspace.yaml above the working directory."
      );
    }
    dir = parent;
  }
};

// The credentials file must be ignored before it exists.
export const assertIgnoredByGit = (repoRoot: string): void => {
  try {
    execFileSync("git", ["check-ignore", "-q", CREDENTIALS_FILE_NAME], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${CREDENTIALS_FILE_NAME} is not ignored by git, or git is unavailable. Add it to .gitignore before creating it.`
    );
  }
};

const cell = (value: string): string =>
  value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

// Passwords an earlier run wrote, by email, so a run that cannot recover a password keeps the old one.
export const previousPasswords = (text: string): Map<string, string> => {
  const found = new Map<string, string>();
  const start = text.indexOf(STAFF_DEMO_START);
  const end = text.indexOf(STAFF_DEMO_END);
  if (start === -1 || end <= start) {
    return found;
  }
  for (const line of text.slice(start, end).split("\n")) {
    const cells = line.split("|").map((part) => part.trim());
    if (cells.length > 4 && cells[2].includes("@") && !cells[3].includes("not recoverable")) {
      found.set(cells[2], cells[3]);
    }
  }
  return found;
};

export const renderStaffBlock = (
  rows: CredentialRow[],
  previous: Map<string, string>
): string =>
  [
    "| Role | Email | Password | Created by | How to reset |",
    "|---|---|---|---|---|",
    ...rows.map((row) => {
      const password = row.password ?? previous.get(row.email) ?? NOT_RECOVERABLE;
      return `| ${cell(row.role)} | ${cell(row.email)} | ${cell(password)} | ${cell(row.createdBy)} | ${cell(row.reset)} |`;
    }),
  ].join("\n");

export const applyStaffBlock = (text: string, block: string): string => {
  const wrapped = `${STAFF_DEMO_START}\n${block}\n${STAFF_DEMO_END}`;
  const start = text.indexOf(STAFF_DEMO_START);
  const end = text.indexOf(STAFF_DEMO_END);
  if (start !== -1 && end > start) {
    return `${text.slice(0, start)}${wrapped}${text.slice(end + STAFF_DEMO_END.length)}`;
  }

  const lines = text.split("\n");
  const heading = lines.findIndex((line) => line.trim() === ACCOUNTS_HEADING);
  if (heading === -1) {
    const tail = text.endsWith("\n") ? "" : "\n";
    return `${text}${tail}\n${ACCOUNTS_HEADING}\n\n${wrapped}\n`;
  }

  let sectionEnd = lines.findIndex((line, index) => index > heading && line.startsWith("## "));
  if (sectionEnd === -1) {
    sectionEnd = lines.length;
  }
  const seedEnd = lines.findIndex(
    (line, index) => index > heading && index < sectionEnd && line.trim() === SEED_END
  );
  const insertAfter = seedEnd === -1 ? heading : seedEnd;
  lines.splice(insertAfter + 1, 0, "", ...wrapped.split("\n"));
  return lines.join("\n");
};

export const upsertAccountsRows = ({
  repoRoot,
  rows,
}: {
  repoRoot: string;
  rows: CredentialRow[];
}): string => {
  assertIgnoredByGit(repoRoot);

  const filePath = path.join(repoRoot, CREDENTIALS_FILE_NAME);
  const templatePath = path.join(repoRoot, TEMPLATE_PATH);
  if (!existsSync(filePath) && !existsSync(templatePath)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `${TEMPLATE_PATH} is missing, so ${CREDENTIALS_FILE_NAME} cannot be created.`
    );
  }
  const base = readFileSync(existsSync(filePath) ? filePath : templatePath, "utf8");
  const block = renderStaffBlock(rows, previousPasswords(base));
  writeFileSync(filePath, applyStaffBlock(base, block));
  return filePath;
};
