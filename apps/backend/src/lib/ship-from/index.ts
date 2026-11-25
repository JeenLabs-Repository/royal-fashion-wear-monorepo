import type { MedusaContainer } from "@medusajs/framework/types";
import { getDefaultSalesChannelId } from "../catalog/default-sales-channel";
import { getQuery } from "../catalog/load-content";
import { getStateByCode } from "../geo-india/states";
import { getVendorModule } from "../vendor/vendor-module";
import { type ShipFromState, formatShipFromLabel, normalizeStates } from "./label";
import { TtlCache } from "./ttl-cache";

export { formatShipFromLabel };
export type { ShipFromState };

// Sixty seconds per product, at most 5,000 products, oldest dropped first.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 5_000;
const PAGE = 1_000;

const cache = new TtlCache<ShipFromState[]>({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

export const clearShipFromCache = (): void => cache.clear();
export const shipFromCacheSize = (): number => cache.size();

type Row = Record<string, any>;

/** Reads every page of a graph query; the graph default would cut a long list short. */
async function graphAll(scope: MedusaContainer, config: Record<string, unknown>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const { data } = await getQuery(scope).graph({
      ...config,
      pagination: { skip, take: PAGE },
    });
    rows.push(...data);
    if (data.length < PAGE) {
      return rows;
    }
  }
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/**
 * Published products that are linked to the default sales channel, with the
 * inventory item ids of their variants. Everything else is simply absent.
 */
async function loadSellableProducts(
  scope: MedusaContainer,
  productIds: string[]
): Promise<{ channelId: string; products: Map<string, string[]> }> {
  const channelId = await getDefaultSalesChannelId(scope);
  const products = new Map<string, string[]>();
  if (productIds.length === 0) {
    return { channelId, products };
  }
  const rows = await graphAll(scope, {
    entity: "product",
    fields: ["id", "status", "sales_channels.id", "variants.id", "variants.inventory_items.inventory_item_id"],
    filters: { id: productIds, status: "published" },
  });
  for (const row of rows) {
    const linked = (row.sales_channels ?? []).some((channel: Row) => channel?.id === channelId);
    if (!linked) {
      continue;
    }
    const itemIds: string[] = [];
    for (const variant of row.variants ?? []) {
      for (const link of variant?.inventory_items ?? []) {
        if (link?.inventory_item_id) {
          itemIds.push(String(link.inventory_item_id));
        }
      }
    }
    products.set(String(row.id), unique(itemIds));
  }
  return { channelId, products };
}

/** The ids, in request order, of products a customer could currently open. */
export async function filterSellableProducts(
  scope: MedusaContainer,
  productIds: string[]
): Promise<string[]> {
  const { products } = await loadSellableProducts(scope, unique(productIds));
  return unique(productIds).filter((id) => products.has(id));
}

async function computeStates(
  scope: MedusaContainer,
  productIds: string[]
): Promise<Map<string, ShipFromState[]>> {
  const result = new Map<string, ShipFromState[]>(productIds.map((id) => [id, []]));
  const { channelId, products } = await loadSellableProducts(scope, productIds);
  if (products.size === 0) {
    return result;
  }

  const channels = await graphAll(scope, {
    entity: "sales_channel",
    fields: ["id", "stock_locations.id"],
    filters: { id: channelId },
  });
  const channelLocationIds = unique(
    channels.flatMap((channel) => (channel.stock_locations ?? []).map((location: Row) => String(location.id)))
  );
  if (channelLocationIds.length === 0) {
    return result;
  }

  const vendors = getVendorModule(scope);
  const locations = await vendors.listVendorLocations(
    { stock_location_id: channelLocationIds, status: "active" },
    { take: null }
  );
  if (locations.length === 0) {
    return result;
  }
  const activeVendors = await vendors.listVendors(
    { id: unique(locations.map((location) => String(location.vendor_id))), status: "active" },
    { take: null }
  );
  const activeVendorIds = new Set(activeVendors.map((vendor) => String(vendor.id)));
  const stateByLocation = new Map<string, ShipFromState>();
  for (const location of locations) {
    if (!activeVendorIds.has(String(location.vendor_id))) {
      continue;
    }
    const state = getStateByCode(String(location.state_code));
    if (state) {
      stateByLocation.set(String(location.stock_location_id), { code: state.code, name: state.name });
    }
  }
  if (stateByLocation.size === 0) {
    return result;
  }

  const itemIds = unique([...products.values()].flat());
  if (itemIds.length === 0) {
    return result;
  }
  const levels = await graphAll(scope, {
    entity: "inventory_level",
    fields: ["inventory_item_id", "location_id", "stocked_quantity", "reserved_quantity"],
    filters: { inventory_item_id: itemIds, location_id: [...stateByLocation.keys()] },
  });

  // Available means stocked minus reserved is above zero at that location.
  const stateByItem = new Map<string, ShipFromState[]>();
  for (const level of levels) {
    const available = Number(level.stocked_quantity ?? 0) - Number(level.reserved_quantity ?? 0);
    const state = stateByLocation.get(String(level.location_id));
    if (available > 0 && state) {
      const list = stateByItem.get(String(level.inventory_item_id)) ?? [];
      list.push(state);
      stateByItem.set(String(level.inventory_item_id), list);
    }
  }
  for (const [productId, items] of products) {
    result.set(productId, normalizeStates(items.flatMap((item) => stateByItem.get(item) ?? [])));
  }
  return result;
}

/**
 * States a product ships from, per product id: only active vendor locations of
 * active vendors that are linked to the default sales channel and have stock
 * above their reservations. Products that are not on sale answer an empty list.
 */
export async function getShipFromStates(
  scope: MedusaContainer,
  productIds: string[]
): Promise<Map<string, ShipFromState[]>> {
  const wanted = unique(productIds);
  const answer = new Map<string, ShipFromState[]>();
  const missing: string[] = [];
  for (const id of wanted) {
    const cached = cache.get(id);
    if (cached) {
      answer.set(id, cached);
    } else {
      missing.push(id);
    }
  }
  if (missing.length > 0) {
    const fresh = await computeStates(scope, missing);
    for (const id of missing) {
      const states = fresh.get(id) ?? [];
      cache.set(id, states);
      answer.set(id, states);
    }
  }
  return answer;
}

/**
 * The state of one stock location, whatever the status of its vendor or location,
 * for order pages that name where a parcel left from. Hub and unknown ids answer null.
 */
export async function shipFromStateForStockLocation(
  scope: MedusaContainer,
  stockLocationId: string
): Promise<ShipFromState | null> {
  const [location] = await getVendorModule(scope).listVendorLocations(
    { stock_location_id: stockLocationId },
    { take: 1 }
  );
  if (!location) {
    return null;
  }
  const state = getStateByCode(String(location.state_code));
  return state ? { code: state.code, name: state.name } : null;
}
