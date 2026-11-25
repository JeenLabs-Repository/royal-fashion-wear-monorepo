import type { MedusaContainer } from "@medusajs/framework/types";
import { CSV_HEADER } from "./constants";
import { loadVendorStockRows } from "./serializers";

export const CSV_HEADER_LINE = CSV_HEADER.join(",");

/** The template is the header plus one example row. The example SKU is unknown, so uploading it unchanged applies nothing. */
export const TEMPLATE_BODY = `${CSV_HEADER_LINE}\nEXAMPLE-SKU,LOC-0001,10\n`;

/**
 * Stops a spreadsheet program from running a cell as a formula. A cell that starts with `=`,
 * `+`, `@`, a tab or a carriage return, or with `-` followed by something other than a digit,
 * gets a leading apostrophe. Plain numbers such as `-5` and ordinary SKUs are left alone.
 */
export function sanitizeCell(value: string): string {
  if (/^[=+@\t\r]/.test(value) || /^-(?!\d)/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/** Removes exactly one leading apostrophe, the one `sanitizeCell` adds. */
export function stripLeadingApostrophe(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}

const quoteCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * Every live variant of the vendor by every owned location with the current stocked quantity,
 * ordered by vendor SKU then location code. Only the vendor's own rows are ever read.
 */
export async function buildExportCsv(scope: MedusaContainer, vendorId: string): Promise<string> {
  const { rows } = await loadVendorStockRows(scope, vendorId);
  const lines = [CSV_HEADER_LINE];
  const sorted = [...rows].sort((x, y) => x.vendor_sku.localeCompare(y.vendor_sku));
  for (const row of sorted) {
    const levels = [...row.levels].sort((x, y) => x.location_code.localeCompare(y.location_code));
    for (const level of levels) {
      lines.push(
        [
          quoteCell(sanitizeCell(row.vendor_sku)),
          quoteCell(sanitizeCell(level.location_code)),
          String(level.stocked_quantity),
        ].join(",")
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
