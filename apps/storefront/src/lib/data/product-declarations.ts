"use server"

import { sdk } from "@lib/config"

export type DeclarationLine = { label: string; value: string }
export type DeclarationsByProduct = Record<string, DeclarationLine[]>

// The route answers at most this many products per request.
const MAX_IDS = 24

/**
 * The declaration lines the store may show for each product. What appears is
 * decided on the server by the display mode; in the default mode the answer is
 * empty. The request carries no credentials header. A failed lookup returns an
 * empty object, so the page shows nothing rather than an error.
 *
 * @param productIds Core product ids
 * @returns Map from product id to its lines
 */
export const getProductDeclarations = async (
  productIds: string[]
): Promise<DeclarationsByProduct> => {
  const ids = Array.from(new Set(productIds.filter(Boolean))).slice(0, MAX_IDS)

  if (ids.length === 0) {
    return {}
  }

  return sdk.client
    .fetch<{
      declarations: { product_id: string; lines: DeclarationLine[] }[]
    }>("/store/product-declarations", {
      method: "GET",
      query: { product_ids: ids.join(",") },
      next: { tags: ["products"], revalidate: 60 },
      cache: "force-cache",
    })
    .then(({ declarations }) =>
      Object.fromEntries(
        (declarations ?? []).map((entry) => [entry.product_id, entry.lines ?? []])
      )
    )
    .catch(() => ({}))
}
