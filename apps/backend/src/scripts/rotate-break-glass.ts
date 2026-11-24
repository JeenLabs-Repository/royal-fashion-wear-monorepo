import type { ExecArgs } from "@medusajs/framework/types";
import {
  BREAK_GLASS_REMINDER,
  ENROL_REMINDER,
  PASSWORD_LABEL,
  positionalArgs,
  rotateBreakGlass,
} from "../lib/staff-cli/operations";

const USAGE = "Usage: pnpm --dir apps/backend run staff:rotate-break-glass";

export default async function rotateBreakGlassScript({ container, args }: ExecArgs) {
  if (positionalArgs(args).length > 0) {
    throw new Error(USAGE);
  }

  const result = await rotateBreakGlass(container);

  console.log(`Break-glass password rotated for ${result.email}. MFA factors were reset.`);
  console.log(PASSWORD_LABEL);
  console.log(result.password);
  console.log(ENROL_REMINDER);
  console.log("Replace the sealed copy with this password and the new recovery codes, then close any open review.");
  console.log(BREAK_GLASS_REMINDER);
}
