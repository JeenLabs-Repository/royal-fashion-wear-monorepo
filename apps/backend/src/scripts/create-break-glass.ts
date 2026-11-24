import type { ExecArgs } from "@medusajs/framework/types";
import {
  BREAK_GLASS_REMINDER,
  ENROL_REMINDER,
  PASSWORD_LABEL,
  createBreakGlass,
  positionalArgs,
} from "../lib/staff-cli/operations";

const USAGE =
  "Usage: pnpm --dir apps/backend run staff:create-break-glass -- <email>. The owner chooses the address.";

export default async function createBreakGlassScript({ container, args }: ExecArgs) {
  const [email, ...extra] = positionalArgs(args);
  if (!email || extra.length > 0) {
    throw new Error(USAGE);
  }

  const result = await createBreakGlass(container, { email });

  console.log(`Break-glass account created for ${result.email} (user ${result.userId}).`);
  console.log(PASSWORD_LABEL);
  console.log(result.password);
  console.log(ENROL_REMINDER);
  console.log("Seal the password and the TOTP recovery codes together, offline.");
  console.log(BREAK_GLASS_REMINDER);
}
