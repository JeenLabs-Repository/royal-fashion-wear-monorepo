import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExecArgs } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { buildDirectory, parseCsv } from "../src/lib/geo-india/pincode-build";

const MIN_PINS = 15000;
const MAX_PINS = 25000;

// pnpm inserts a bare "--" before script args, which yargs drops from medusa
// exec's positional args. Prefer an explicit arg, then PINCODE_CSV, then a .csv
// path on process.argv, then the default download path.
function resolveCsvPath(args: string[] | undefined): string {
  const fromArgs = (args ?? []).find((value) => value && value !== "--");
  const fromEnv = process.env.PINCODE_CSV?.trim();
  const fromArgv = process.argv.find(
    (value) => value.endsWith(".csv") && !value.includes("node_modules")
  );
  return resolve(
    process.cwd(),
    fromArgs ?? fromEnv ?? fromArgv ?? "data-source/pincode-directory.csv"
  );
}

// Run from apps/backend: pnpm run build:pincodes -- data-source/pincode-directory.csv
export default async function buildPincodeData({ args }: ExecArgs) {
  const csvPath = resolveCsvPath(args);
  const outPath = resolve(process.cwd(), "src/lib/geo-india/pincodes.json");

  try {
    console.log(`[pincode-build] reading ${csvPath}`);
    const rows = parseCsv(readFileSync(csvPath, "utf8"));
    const result = buildDirectory(rows, new Date().toISOString().slice(0, 10));
    const { count } = result.directory;

    console.log(`[pincode-build] rows read: ${result.rows_read}`);
    console.log(`[pincode-build] rows skipped: ${result.rows_skipped}`);
    console.log(`[pincode-build] conflicts: ${result.conflicts}`);
    console.log(`[pincode-build] PINs: ${count}`);

    if (count < MIN_PINS || count > MAX_PINS) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `PIN count ${count} is outside ${MIN_PINS} to ${MAX_PINS}.`
      );
    }

    writeFileSync(outPath, JSON.stringify(result.directory));
    console.log(`[pincode-build] wrote ${outPath} (${statSync(outPath).size} bytes)`);
  } catch (error) {
    // A failed run must not leave a half-trusted file behind and must stop the shell.
    console.error("[pincode-build]", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
