import type { MedusaContainer } from "@medusajs/framework/types";
import { getCatalogService, getQuery } from "../catalog/load-content";
import { defineAllowlistSerializer } from "../serializers";
import { getVendorModule } from "../vendor/vendor-module";
import { LOW_STOCK_THRESHOLD } from "./constants";

type Row = Record<string, any>;

// Vendor-facing page of the stock list. It holds codes and labels of the vendor's own
// locations and its own SKUs; it never holds a stock location id, a vendor id, core metadata
// or a customer price.
export const inventoryPageSerializer = defineAllowlistSerializer({
  name: "vendor-inventory-page",
  audience: "vendor",
  shape: {
    locations: { code: true, label: true },
    variants: {
      variant_id: true,
      product_title: true,
      variant_title: true,
      vendor_sku: true,
      levels: {
        location_code: true,
        stocked_quantity: true,
        reserved_quantity: true,
        low_stock: true,
      },
    },
    count: true,
    limit: true,
    offset: true,
    low_stock_threshold: true,
  },
});

export type StockLevelView = {
  location_code: string;
  stocked_quantity: number;
  reserved_quantity: number;
  low_stock: boolean;
};

export type StockRowView = {
  variant_id: string;
  product_title: string;
  variant_title: string;
  vendor_sku: string;
  levels: StockLevelView[];
};

export type LoadedStockRows = {
  locations: { code: string; label: string; stock_location_id: string }[];
  rows: StockRowView[];
  count: number;
};

/**
 * Live variants of one vendor with a level per owned location (zero when no level exists).
 * `limit` undefined returns every matching row. Rows are ordered by product title, then SKU.
 * Catalog sizes at launch are small, so the vendor's variants are read in one pass.
 */
export async function loadVendorStockRows(
  scope: MedusaContainer,
  vendorId: string,
  options: { q?: string; limit?: number; offset?: number } = {}
): Promise<LoadedStockRows> {
  const catalog = getCatalogService(scope);
  const query = getQuery(scope);

  const locationRows = (await getVendorModule(scope).listVendorLocations(
    { vendor_id: vendorId },
    { take: null, order: { code: "ASC" } }
  )) as Row[];
  const locations = locationRows.map((location) => ({
    code: String(location.code),
    label: String(location.label),
    stock_location_id: String(location.stock_location_id),
  }));

  const submissions = (await catalog.listProductSubmissions(
    { vendor_id: vendorId, is_live: true },
    { take: null }
  )) as Row[];
  const productIds = submissions.map((submission) => String(submission.product_id));
  if (productIds.length === 0) {
    return { locations, rows: [], count: 0 };
  }

  const refs = (await catalog.listVendorVariantRefs(
    { vendor_id: vendorId, product_id: productIds },
    { take: null }
  )) as Row[];
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "variants.id", "variants.title", "variants.inventory_items.inventory_item_id"],
    filters: { id: productIds },
  });

  const info = new Map<string, { product_title: string; variant_title: string; item_id: string | null }>();
  for (const product of products as Row[]) {
    for (const variant of (product.variants ?? []) as Row[]) {
      info.set(String(variant.id), {
        product_title: String(product.title),
        variant_title: String(variant.title ?? ""),
        item_id: variant.inventory_items?.[0]?.inventory_item_id
          ? String(variant.inventory_items[0].inventory_item_id)
          : null,
      });
    }
  }

  const needle = options.q?.trim().toLowerCase();
  const matching = refs
    .filter((ref) => info.has(String(ref.variant_id)))
    .map((ref) => ({ ref, detail: info.get(String(ref.variant_id))! }))
    .filter(({ detail }) => !needle || detail.product_title.toLowerCase().includes(needle))
    .sort(
      (x, y) =>
        x.detail.product_title.localeCompare(y.detail.product_title) ||
        String(x.ref.vendor_sku).localeCompare(String(y.ref.vendor_sku))
    );
  const count = matching.length;
  const offset = options.offset ?? 0;
  const page = options.limit === undefined ? matching : matching.slice(offset, offset + options.limit);

  const itemIds = [...new Set(page.map(({ detail }) => detail.item_id).filter(Boolean))] as string[];
  const levelByKey = new Map<string, Row>();
  if (itemIds.length > 0 && locations.length > 0) {
    const { data: levels } = await query.graph({
      entity: "inventory_level",
      fields: ["inventory_item_id", "location_id", "stocked_quantity", "reserved_quantity"],
      filters: {
        inventory_item_id: itemIds,
        location_id: locations.map((location) => location.stock_location_id),
      },
    });
    for (const level of levels as Row[]) {
      levelByKey.set(`${level.inventory_item_id}:${level.location_id}`, level);
    }
  }

  const rows: StockRowView[] = page.map(({ ref, detail }) => ({
    variant_id: String(ref.variant_id),
    product_title: detail.product_title,
    variant_title: detail.variant_title,
    vendor_sku: String(ref.vendor_sku),
    levels: locations.map((location) => {
      const level = detail.item_id
        ? levelByKey.get(`${detail.item_id}:${location.stock_location_id}`)
        : undefined;
      const stocked = Number(level?.stocked_quantity ?? 0);
      const reserved = Number(level?.reserved_quantity ?? 0);
      return {
        location_code: location.code,
        stocked_quantity: stocked,
        reserved_quantity: reserved,
        low_stock: stocked - reserved < LOW_STOCK_THRESHOLD,
      };
    }),
  }));
  return { locations, rows, count };
}

/** The answer of `GET /vendor/inventory`. */
export async function readInventoryPage(
  scope: MedusaContainer,
  vendorId: string,
  query: { limit: number; offset: number; q?: string }
) {
  const loaded = await loadVendorStockRows(scope, vendorId, query);
  return inventoryPageSerializer.serialize({
    locations: loaded.locations.map((location) => ({ code: location.code, label: location.label })),
    variants: loaded.rows,
    count: loaded.count,
    limit: query.limit,
    offset: query.offset,
    low_stock_threshold: LOW_STOCK_THRESHOLD,
  });
}
