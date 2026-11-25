import { once } from "node:events";
import type { MedusaContainer } from "@medusajs/framework/types";
import { parse } from "csv-parse";
import {
  CSV_HEADER,
  DECODE_SLICE_BYTES,
  IMPORT_BATCH_SIZE,
  IMPORT_MAX_LISTED_ERRORS,
  IMPORT_MAX_ROWS,
  MAX_STOCK_QUANTITY,
} from "./constants";
import { stripLeadingApostrophe } from "./csv-export";
import { StockError, stockError } from "./errors";

export type RowCode =
  | "unknown_sku"
  | "unknown_location"
  | "not_approved"
  | "invalid_quantity"
  | "below_reserved"
  | "duplicate_row";

export type RowError = { row: number; code: RowCode; message: string };

export type ImportResult = { applied: number; failed: number; errors: RowError[] };

const ROW_MESSAGES: Record<RowCode, string> = {
  unknown_sku: "The SKU is not one of your products.",
  unknown_location: "The location code is not one of your locations.",
  not_approved: "The product is not approved yet.",
  invalid_quantity: "The quantity must be a whole number from 0 to 1,000,000.",
  below_reserved: "The quantity is below the units already reserved at this location.",
  duplicate_row: "This SKU and location already appear earlier in the file.",
};

// Workflow codes mapped to the six row codes of the import.
const WORKFLOW_CODE: Record<string, RowCode> = {
  unknown_variant: "unknown_sku",
  unknown_location: "unknown_location",
  not_approved: "not_approved",
  invalid_quantity: "invalid_quantity",
  below_reserved: "below_reserved",
  duplicate_entry: "duplicate_row",
};

/**
 * Decoded text in pieces of at most one slice of bytes each. The decoder is strict, so any invalid
 * UTF-8 byte throws `invalid_utf8`, and it is streaming, so a character split across two slices
 * is decoded whole. The parser never receives the whole text as one string.
 */
export function* decodeInSlices(buffer: Buffer): Generator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (let offset = 0; offset < buffer.length; offset += DECODE_SLICE_BYTES) {
      const piece = decoder.decode(buffer.subarray(offset, offset + DECODE_SLICE_BYTES), {
        stream: true,
      });
      if (piece.length > 0) {
        yield piece;
      }
    }
    const rest = decoder.decode();
    if (rest.length > 0) {
      yield rest;
    }
  } catch {
    throw stockError("invalid_utf8", "The file is not UTF-8 text.");
  }
}

/** The header must be exactly `vendor_sku,location_code,stocked_quantity`, in that order. */
export function assertHeader(record: string[]): void {
  const matches =
    record.length === CSV_HEADER.length &&
    record.every((cell, index) => cell.trim().toLowerCase() === CSV_HEADER[index]);
  if (!matches) {
    throw stockError(
      "invalid_header",
      `The first line must be ${CSV_HEADER.join(",")}.`
    );
  }
}

// Records one at a time from the streaming parser. A parser failure is `invalid_csv`; a decode
// failure keeps its own code. The writer and the reader run together, so memory stays bounded.
async function* readRecords(buffer: Buffer): AsyncGenerator<string[]> {
  const parser = parse({
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
  const abort = new AbortController();
  const feed = (async () => {
    for (const piece of decodeInSlices(buffer)) {
      if (!parser.write(piece)) {
        await once(parser, "drain", { signal: abort.signal });
      }
    }
    parser.end();
  })().catch((error: unknown) => {
    if (!abort.signal.aborted) {
      parser.destroy(error as Error);
    }
  });

  try {
    for await (const record of parser) {
      yield record as string[];
    }
  } catch (error) {
    if (error instanceof StockError) {
      throw error;
    }
    throw stockError("invalid_csv", "The file is not valid CSV.");
  } finally {
    abort.abort();
    parser.destroy();
    await feed;
  }
}

/**
 * First pass. Proves the whole file is acceptable before anything is written: a header that
 * matches, valid UTF-8, well-formed CSV and at most 5,000 data rows. An empty file is
 * `file_required`; a file with only the header has zero rows.
 */
export async function scanCsv(buffer: Buffer): Promise<{ rows: number }> {
  if (buffer.length === 0) {
    throw stockError("file_required", "The file is empty.");
  }
  let sawHeader = false;
  let rows = 0;
  for await (const record of readRecords(buffer)) {
    if (!sawHeader) {
      assertHeader(record);
      sawHeader = true;
      continue;
    }
    rows += 1;
    if (rows > IMPORT_MAX_ROWS) {
      throw stockError("too_many_rows", `The file can have at most ${IMPORT_MAX_ROWS} rows.`);
    }
  }
  if (!sawHeader) {
    throw stockError("invalid_header", `The first line must be ${CSV_HEADER.join(",")}.`);
  }
  return { rows };
}

type RawRow = { row: number; sku: string; location: string; quantity: string };

export type ApplyCsvInput = {
  buffer: Buffer;
  scope: MedusaContainer;
  vendorId: string;
  actor: { id: string; label: string | null };
};

/**
 * Second pass. Reads the same file again and applies it in batches of 100 rows through the same
 * workflow the PUT route uses, in partial mode, so a bad row never stops a good one. The data row
 * number counts rows after the header. Nothing here can fail the whole file: the first pass
 * already proved it is acceptable. Heavy modules load on first use so the scanner stays light.
 */
export async function applyCsv(input: ApplyCsvInput): Promise<ImportResult> {
  const { setVendorStockWorkflow } = await import("../../workflows/stock/set-vendor-stock");
  const { getCatalogService } = await import("../catalog/load-content");
  const { getVendorModule } = await import("../vendor/vendor-module");
  const { recordAudit } = await import("../audit");

  const catalog = getCatalogService(input.scope);
  const locations = (await getVendorModule(input.scope).listVendorLocations(
    { vendor_id: input.vendorId },
    { take: null }
  )) as { code: string }[];
  const locationByUpper = new Map(locations.map((location) => [String(location.code).toUpperCase(), String(location.code)]));

  const seen = new Set<string>();
  const errors: RowError[] = [];
  let applied = 0;
  let failed = 0;

  const flush = async (batch: RawRow[]): Promise<void> => {
    const batchErrors: RowError[] = [];
    const fail = (row: number, code: RowCode, message = ROW_MESSAGES[code]) =>
      batchErrors.push({ row, code, message });

    const skus = [
      ...new Set(batch.map((raw) => stripLeadingApostrophe(raw.sku).trim()).filter((sku) => sku.length > 0)),
    ];
    const refs = skus.length
      ? ((await catalog.listVendorVariantRefs(
          { vendor_id: input.vendorId, vendor_sku: skus },
          { take: null }
        )) as { vendor_sku: string; variant_id: string }[])
      : [];
    const variantBySku = new Map(refs.map((ref) => [String(ref.vendor_sku), String(ref.variant_id)]));

    const entries: { index: number; variant_id: string; location_code: string; stocked_quantity: number }[] = [];
    for (const raw of batch) {
      const sku = stripLeadingApostrophe(raw.sku).trim();
      const variantId = sku ? variantBySku.get(sku) : undefined;
      if (!variantId) {
        fail(raw.row, "unknown_sku");
        continue;
      }
      const locationCode = locationByUpper.get(raw.location.trim().toUpperCase());
      if (!locationCode) {
        fail(raw.row, "unknown_location");
        continue;
      }
      if (!/^\d{1,7}$/.test(raw.quantity) || Number(raw.quantity) > MAX_STOCK_QUANTITY) {
        fail(raw.row, "invalid_quantity");
        continue;
      }
      const pair = `${sku}\u0001${locationCode}`;
      if (seen.has(pair)) {
        fail(raw.row, "duplicate_row");
        continue;
      }
      seen.add(pair);
      entries.push({
        index: raw.row,
        variant_id: variantId,
        location_code: locationCode,
        stocked_quantity: Number(raw.quantity),
      });
    }

    if (entries.length > 0) {
      const { result } = await setVendorStockWorkflow(input.scope).run({
        input: { vendor_id: input.vendorId, actor: input.actor, entries, mode: "partial" },
      });
      for (const item of result.results) {
        if (item.status === "rejected") {
          const code = WORKFLOW_CODE[item.code] ?? "invalid_quantity";
          fail(
            item.index,
            code,
            code === "below_reserved" && item.reserved !== undefined
              ? `The quantity is below the ${item.reserved} units reserved at this location.`
              : ROW_MESSAGES[code]
          );
        } else {
          applied += 1;
        }
      }
    }

    batchErrors.sort((x, y) => x.row - y.row);
    failed += batchErrors.length;
    for (const error of batchErrors) {
      if (errors.length < IMPORT_MAX_LISTED_ERRORS) {
        errors.push(error);
      }
    }
  };

  let sawHeader = false;
  let rowNumber = 0;
  let batch: RawRow[] = [];
  for await (const record of readRecords(input.buffer)) {
    if (!sawHeader) {
      sawHeader = true;
      continue;
    }
    rowNumber += 1;
    batch.push({
      row: rowNumber,
      sku: record[0] ?? "",
      location: record[1] ?? "",
      quantity: record[2] ?? "",
    });
    if (batch.length === IMPORT_BATCH_SIZE) {
      await flush(batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await flush(batch);
  }

  // One summary entry per import: totals only, never the file name or its content.
  await recordAudit(input.scope, {
    action: "stock.updated",
    actor: { id: input.actor.id, type: "vendor", label: input.actor.label },
    target: { type: "vendor", id: input.vendorId },
    meta: { kind: "import_summary", applied, failed },
  });

  return { applied, failed, errors };
}
