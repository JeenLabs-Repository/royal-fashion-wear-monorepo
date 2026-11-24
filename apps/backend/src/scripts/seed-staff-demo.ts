import type { ExecArgs } from "@medusajs/framework/types";
import { DEMO_TEST_DATA_ADMIN_EMAIL } from "../lib/dev-seed/demo-staff";
import {
  assertIgnoredByGit,
  findRepoRoot,
  upsertAccountsRows,
  CREDENTIALS_FILE_NAME,
} from "../lib/staff-cli/credentials-file";
import { positionalArgs, seedDemoStaff } from "../lib/staff-cli/operations";

const USAGE =
  "Usage: pnpm --dir apps/backend run seed:staff-demo -- [reset-mfa] [reset-passwords]";
const RESET_TEXT =
  "run pnpm --dir apps/backend run seed:staff-demo -- reset-passwords reset-mfa";

export default async function seedStaffDemoScript({ container, args }: ExecArgs) {
  const words = positionalArgs(args);
  if (words.some((word) => word !== "reset-mfa" && word !== "reset-passwords")) {
    throw new Error(USAGE);
  }
  const production = process.env.NODE_ENV === "production";

  // The credentials file must be ignored before any account is created, so a
  // password that cannot be recorded is never generated.
  const repoRoot = findRepoRoot();
  assertIgnoredByGit(repoRoot);

  const rows = await seedDemoStaff(container, {
    production,
    resetMfa: words.includes("reset-mfa"),
    resetPasswords: words.includes("reset-passwords"),
  });

  upsertAccountsRows({
    repoRoot,
    rows: rows.map((row) => ({
      role: row.role,
      email: row.email,
      // The test data admin keeps the password the test data seed recorded above.
      password:
        row.email === DEMO_TEST_DATA_ADMIN_EMAIL
          ? "unchanged, see the test data rows above"
          : row.password,
      createdBy:
        row.email === DEMO_TEST_DATA_ADMIN_EMAIL
          ? "test data seed (superadmin role added by seed-staff-demo)"
          : "seed-staff-demo",
      reset: RESET_TEXT,
    })),
  });

  for (const row of rows) {
    const note = row.password
      ? "password recorded"
      : "existing account, password kept (add reset-passwords to replace it)";
    console.log(`${row.role.padEnd(18)} ${row.email}  ${row.mfa}  ${note}`);
  }
  console.log(`Wrote the staff section of ${CREDENTIALS_FILE_NAME}.`);
  console.log("Demo users start without TOTP. Enrol under Profile > Security, or let the browser specs do it.");
}
