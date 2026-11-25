import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { getCatalogService, getQuery } from "../../../lib/catalog/load-content";
import { MAX_STOCK_QUANTITY } from "../../../lib/stock/constants";
import { notFoundError, stockError } from "../../../lib/stock/errors";
import { getVendorModule } from "../../../lib/vendor/vendor-module";

type Row = Record<string, any>;

export type StockEntryInput = {
  /** Position in the request, or the data row number of an import. */
  index: number;
  variant_id: string;
  location_code: string;
  stocked_quantity: number;
};

export type StockEntryCode =
  | "not_approved"
  | "below_reserved"
  | "invalid_quantity"
  | "duplicate_entry"
  | "unknown_variant"
  | "unknown_location";

export type StockEntryProblem = { index: number; code: StockEntryCode; reserved?: number };

export type ResolvedEntry = {
  index: number;
  variant_id: string;
  location_code: string;
  location_id: string;
  inventory_item_id: string;
  /** Null when the level does not exist yet. */
  level_id: string | null;
  previous_quantity: number | null;
  stocked_quantity: number;
  changed: boolean;
};

export type ValidateStockEntriesInput = {
  vendor_id: string;
  entries: StockEntryInput[];
  /** Strict: any problem refuses the whole request. Partial: valid entries proceed. */
  mode: "strict" | "partial";
};

const unique = <T>(values: T[]): T[] => [...new Set(values)];

async function readContext(container: MedusaContainer, vendorId: string, entries: StockEntryInput[]) {
  const catalog = getCatalogService(container);
  const query = getQuery(container);

  // Ownership comes only from vendor-scoped lookups: the vendor's own locations and its own
  // variant references. A foreign id is simply absent from both maps.
  const locations = (await getVendorModule(container).listVendorLocations(
    { vendor_id: vendorId },
    { take: null }
  )) as Row[];
  const locationByCode = new Map(locations.map((l) => [String(l.code), String(l.stock_location_id)]));

  const variantIds = unique(entries.map((entry) => entry.variant_id));
  const refs = (await catalog.listVendorVariantRefs(
    { vendor_id: vendorId, variant_id: variantIds },
    { take: null }
  )) as Row[];
  const refByVariant = new Map(refs.map((ref) => [String(ref.variant_id), ref]));

  const productIds = unique(refs.map((ref) => String(ref.product_id)));
  const submissions = productIds.length
    ? ((await catalog.listProductSubmissions(
        { vendor_id: vendorId, product_id: productIds },
        { take: null }
      )) as Row[])
    : [];
  const liveProducts = new Set(
    submissions.filter((submission) => submission.is_live).map((submission) => String(submission.product_id))
  );

  const known = [...refByVariant.keys()];
  const itemByVariant = new Map<string, string>();
  if (known.length > 0) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "inventory_items.inventory_item_id"],
      filters: { id: known },
    });
    for (const variant of data as Row[]) {
      const itemId = variant.inventory_items?.[0]?.inventory_item_id;
      if (itemId) {
        itemByVariant.set(String(variant.id), String(itemId));
      }
    }
  }

  const levelByKey = new Map<string, Row>();
  const itemIds = unique([...itemByVariant.values()]);
  if (itemIds.length > 0 && locationByCode.size > 0) {
    const { data } = await query.graph({
      entity: "inventory_level",
      fields: ["id", "inventory_item_id", "location_id", "stocked_quantity", "reserved_quantity"],
      filters: { inventory_item_id: itemIds, location_id: [...locationByCode.values()] },
    });
    for (const level of data as Row[]) {
      levelByKey.set(`${level.inventory_item_id}:${level.location_id}`, level);
    }
  }
  return { locationByCode, refByVariant, liveProducts, itemByVariant, levelByKey };
}

/**
 * Checks every entry against what the vendor owns and what is reserved. Strict mode answers 404
 * for any foreign or unknown variant or location (one answer for both, checked before any other
 * rule so nothing about other vendors leaks) and 400 `stock_rejected` with the full error list
 * for every other problem. Partial mode returns per-entry problems and lets valid entries pass.
 */
export const validateStockEntriesStep = createStep(
  "validate-stock-entries",
  async (input: ValidateStockEntriesInput, { container }) => {
    const ctx = await readContext(container, input.vendor_id, input.entries);
    const problems: StockEntryProblem[] = [];
    const resolved: ResolvedEntry[] = [];
    const seen = new Set<string>();

    if (input.mode === "strict") {
      for (const entry of input.entries) {
        if (!ctx.refByVariant.has(entry.variant_id) || !ctx.locationByCode.has(entry.location_code)) {
          throw notFoundError();
        }
      }
    }

    for (const entry of input.entries) {
      const ref = ctx.refByVariant.get(entry.variant_id);
      if (!ref) {
        problems.push({ index: entry.index, code: "unknown_variant" });
        continue;
      }
      const locationId = ctx.locationByCode.get(entry.location_code);
      if (!locationId) {
        problems.push({ index: entry.index, code: "unknown_location" });
        continue;
      }
      const quantity = entry.stocked_quantity;
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_STOCK_QUANTITY) {
        problems.push({ index: entry.index, code: "invalid_quantity" });
        continue;
      }
      if (!ctx.liveProducts.has(String(ref.product_id))) {
        problems.push({ index: entry.index, code: "not_approved" });
        continue;
      }
      const pair = `${entry.variant_id}:${entry.location_code}`;
      if (seen.has(pair)) {
        problems.push({ index: entry.index, code: "duplicate_entry" });
        continue;
      }
      seen.add(pair);

      const itemId = ctx.itemByVariant.get(entry.variant_id);
      if (!itemId) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "A live variant has no inventory item."
        );
      }
      const level = ctx.levelByKey.get(`${itemId}:${locationId}`);
      const reserved = Number(level?.reserved_quantity ?? 0);
      if (quantity < reserved) {
        problems.push({ index: entry.index, code: "below_reserved", reserved });
        continue;
      }
      const previous = level ? Number(level.stocked_quantity) : null;
      resolved.push({
        index: entry.index,
        variant_id: entry.variant_id,
        location_code: entry.location_code,
        location_id: locationId,
        inventory_item_id: itemId,
        level_id: level ? String(level.id) : null,
        previous_quantity: previous,
        stocked_quantity: quantity,
        changed: previous === null || previous !== quantity,
      });
    }

    if (input.mode === "strict" && problems.length > 0) {
      throw stockError("stock_rejected", "The stock update was refused.", { errors: problems });
    }
    return new StepResponse({ resolved, problems });
  }
);
