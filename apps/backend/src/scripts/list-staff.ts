import type { ExecArgs } from "@medusajs/framework/types";
import { listStaffRows, positionalArgs } from "../lib/staff-cli/operations";

const USAGE = "Usage: pnpm --dir apps/backend run staff:list";

const line = (cells: string[], widths: number[]) =>
  cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");

export default async function listStaffScript({ container, args }: ExecArgs) {
  if (positionalArgs(args).length > 0) {
    throw new Error(USAGE);
  }

  // The audit entry is written inside listStaffRows, before anything is printed.
  const rows = await listStaffRows(container);

  const header = ["USER ID", "EMAIL", "ROLES", "BREAK-GLASS", "MFA"];
  const body = rows.map((row) => [
    row.user_id,
    row.email,
    row.roles.join(",") || "none",
    row.is_break_glass ? "yes" : "no",
    row.mfa_state,
  ]);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...body.map((cells) => cells[index].length))
  );

  console.log(line(header, widths));
  for (const cells of body) {
    console.log(line(cells, widths));
  }
  console.log(`${rows.length} staff user(s).`);
}
