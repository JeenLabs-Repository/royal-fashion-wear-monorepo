import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEMO_NO_ROLE_USER, DEMO_STAFF } from "../../dev-seed/demo-staff";
import { ROLE_KEYS } from "../../rbac/permissions";
import {
  STAFF_DEMO_END,
  STAFF_DEMO_START,
  applyStaffBlock,
  findRepoRoot,
  previousPasswords,
  renderStaffBlock,
  upsertAccountsRows,
} from "../credentials-file";
import { PASSWORD_ALPHABET, generatePassword } from "../password";

const TEMPLATE = [
  "# Test Credentials",
  "",
  "## Accounts by role",
  "",
  "Intro text.",
  "",
  "<!-- seed:start -->",
  "| Role | Email | Password | Created by | How to reset |",
  "|---|---|---|---|---|",
  "| customer | customer-a@example.test | seeded-secret | test-data-seed | reset |",
  "<!-- seed:end -->",
  "",
  "Later accounts are added by later releases.",
  "",
  "| What | Flow | Values | How to reset |",
  "|---|---|---|---|",
  "",
  "## Form values",
  "",
  "| What | Flow | Values | How to reset |",
  "|---|---|---|---|",
  "",
].join("\n");

const makeRepo = (ignored: boolean) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "staff-cli-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/**\n");
  if (ignored) {
    writeFileSync(path.join(root, ".gitignore"), "TEST-CREDENTIALS.local.md\n");
  }
  mkdirSync(path.join(root, "docs", "testing"), { recursive: true });
  writeFileSync(path.join(root, "docs", "testing", "test-credentials.template.md"), TEMPLATE);
  return root;
};

const rowsFor = (supportPassword: string | null) => [
  {
    role: "superadmin",
    email: "staff.superadmin@example.test",
    password: "pw-superadmin-1",
    createdBy: "seed-staff-demo",
    reset: "run the seed with reset-passwords",
  },
  {
    role: "support",
    email: "staff.support@example.test",
    password: supportPassword,
    createdBy: "seed-staff-demo",
    reset: "run the seed with reset-passwords",
  },
];

describe("generatePassword", () => {
  it("returns 24 characters from the unambiguous alphabet", () => {
    const value = generatePassword(24);
    expect(value).toHaveLength(24);
    for (const char of value) {
      expect(PASSWORD_ALPHABET).toContain(char);
    }
  });

  it("never uses the ambiguous characters 0, O, 1, l or I", () => {
    for (const bad of ["0", "O", "1", "l", "I"]) {
      expect(PASSWORD_ALPHABET).not.toContain(bad);
    }
  });

  it("gives 200 distinct values in 200 calls", () => {
    const values = new Set(Array.from({ length: 200 }, () => generatePassword(24)));
    expect(values.size).toBe(200);
  });

  it.each([0, 5, 11, 129, 12.5])("rejects the length %p", (length) => {
    expect(() => generatePassword(length)).toThrow();
  });
});

describe("demo staff constants", () => {
  it("has exactly one entry per role key", () => {
    expect(DEMO_STAFF.map((entry) => entry.roleKey).sort()).toEqual([...ROLE_KEYS].sort());
  });

  it("uses example.test addresses and unique emails, with a separate no-role user", () => {
    const emails = [...DEMO_STAFF.map((entry) => entry.email), DEMO_NO_ROLE_USER.email];
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) {
      expect(email.endsWith("@example.test")).toBe(true);
    }
    expect(DEMO_STAFF.map((entry) => entry.email)).not.toContain(DEMO_NO_ROLE_USER.email);
  });

  it("has no framework import and no secret word in the source", () => {
    const source = readFileSync(
      path.join(__dirname, "..", "..", "dev-seed", "demo-staff.ts"),
      "utf8"
    );
    expect(source).not.toContain("@medusajs");
    expect(source.toLowerCase()).not.toContain("password");
  });
});

describe("findRepoRoot", () => {
  it("walks up to the folder holding pnpm-workspace.yaml", () => {
    const root = makeRepo(true);
    try {
      const nested = path.join(root, "apps", "backend", "src");
      mkdirSync(nested, { recursive: true });
      expect(findRepoRoot(nested)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("staff demo credentials block", () => {
  it("refuses to write unless git ignores the credentials file", () => {
    const root = makeRepo(false);
    try {
      expect(() => upsertAccountsRows({ repoRoot: root, rows: rowsFor("x") })).toThrow(
        /not ignored/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates the file from the template and writes the block inside the accounts section", () => {
    const root = makeRepo(true);
    try {
      const file = upsertAccountsRows({ repoRoot: root, rows: rowsFor("pw-support-1") });
      const text = readFileSync(file, "utf8");
      const heading = text.indexOf("## Accounts by role");
      const start = text.indexOf(STAFF_DEMO_START);
      const end = text.indexOf(STAFF_DEMO_END);
      const nextSection = text.indexOf("## Form values");
      expect(heading).toBeLessThan(start);
      expect(start).toBeLessThan(end);
      expect(end).toBeLessThan(nextSection);
      expect(text).toContain("pw-support-1");
      // The block sits after the seed block, so rows appended to the last table still land in a table.
      expect(text.indexOf("<!-- seed:end -->")).toBeLessThan(start);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves the seed block and every other section intact", () => {
    const root = makeRepo(true);
    try {
      const file = upsertAccountsRows({ repoRoot: root, rows: rowsFor("pw-support-1") });
      const text = readFileSync(file, "utf8");
      const seedBlock = TEMPLATE.slice(
        TEMPLATE.indexOf("<!-- seed:start -->"),
        TEMPLATE.indexOf("<!-- seed:end -->") + "<!-- seed:end -->".length
      );
      expect(text).toContain(seedBlock);
      expect(text.slice(text.indexOf("## Form values"))).toBe(
        TEMPLATE.slice(TEMPLATE.indexOf("## Form values"))
      );
      expect(text).toContain("Later accounts are added by later releases.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("replaces only its own block on later runs and keeps a password it cannot recover", () => {
    const root = makeRepo(true);
    try {
      const file = upsertAccountsRows({ repoRoot: root, rows: rowsFor("pw-support-1") });
      const first = readFileSync(file, "utf8");
      upsertAccountsRows({ repoRoot: root, rows: rowsFor(null) });
      const second = readFileSync(file, "utf8");
      expect(second).toBe(first);
      expect(second.split(STAFF_DEMO_START)).toHaveLength(2);

      upsertAccountsRows({ repoRoot: root, rows: rowsFor("pw-support-2") });
      const third = readFileSync(file, "utf8");
      expect(third).toContain("pw-support-2");
      expect(third).not.toContain("pw-support-1");
      expect(third).toContain("seeded-secret");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes a not recoverable note for an unknown password with no earlier row", () => {
    const rows = rowsFor(null);
    const block = renderStaffBlock(rows, new Map());
    expect(block).toContain("existing account, password not recoverable");
    expect(previousPasswords(applyStaffBlock(TEMPLATE, block)).size).toBe(1);
  });

  it("appends the heading when the file has no accounts section", () => {
    const text = applyStaffBlock("# Notes\n", "| a |");
    expect(text).toContain("## Accounts by role");
    expect(text).toContain(STAFF_DEMO_START);
  });
});
