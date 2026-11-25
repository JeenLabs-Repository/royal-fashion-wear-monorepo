"use server"

import { sdk } from "@lib/config"

export type ShipFromState = { code: string; name: string }
export type ShipFromByProduct = Record<string, ShipFromState[]>

// The route answers at most this many products per request.
const MAX_IDS = 24

/**
 * Ship-from states for the given products, keyed by product id. The route is
 * public and carries no credentials header, which is the only reason this
 * request may be cached across visitors. A failed lookup returns an empty
 * object, so the page shows no label rather than an error.
 *
 * @param productIds Core product ids
 * @returns Map from product id to the states it ships from
 */
export const getShipFrom = async (
  productIds: string[]
): Promise<ShipFromByProduct> => {
  const ids = Array.from(new Set(productIds.filter(Boolean))).slice(0, MAX_IDS)

  if (ids.length === 0) {
    return {}
  }

  return sdk.client
    .fetch<{ ship_from: { product_id: string; states: ShipFromState[] }[] }>(
      "/store/ship-from",
      {
        method: "GET",
        query: { product_ids: ids.join(",") },
        next: { tags: ["products"], revalidate: 60 },
        cache: "force-cache",
      }
    )
    .then(({ ship_from }) =>
      Object.fromEntries(
        (ship_from ?? []).map((entry) => [entry.product_id, entry.states ?? []])
      )
    )
    .catch(() => ({}))
}
