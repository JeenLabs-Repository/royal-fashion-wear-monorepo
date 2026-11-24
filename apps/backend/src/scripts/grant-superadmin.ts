import type { ExecArgs } from "@medusajs/framework/types";
import {
  ENROL_REMINDER,
  PASSWORD_LABEL,
  grantSuperadmin,
  positionalArgs,
} from "../lib/staff-cli/operations";

const USAGE =
  "Usage: pnpm --dir apps/backend run staff:grant-superadmin -- <email> [reset-password]";

export default async function grantSuperadminScript({ container, args }: ExecArgs) {
  const [email, flag, ...extra] = positionalArgs(args);
  if (!email || extra.length > 0 || (flag !== undefined && flag !== "reset-password")) {
    throw new Error(USAGE);
  }

  const result = await grantSuperadmin(container, {
    email,
    resetPassword: flag === "reset-password",
  });

  console.log(`User ${result.userId}: ${result.created ? "created" : "found"}.`);
  console.log(
    result.alreadySuperadmin ? "Already a superadmin." : "Superadmin role assigned."
  );
  if (result.password) {
    console.log(PASSWORD_LABEL);
    console.log(result.password);
  } else {
    console.log("The password is unchanged. Add reset-password to set a new one.");
  }
  console.log(ENROL_REMINDER);
}
