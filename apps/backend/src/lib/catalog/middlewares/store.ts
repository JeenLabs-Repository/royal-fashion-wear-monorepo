import type { MiddlewareRoute } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";

// No entries: the store routes validate inside their handlers. The slot stays so the
// aggregate file keeps its shape.
export const storeMiddlewares: MiddlewareRoute[] = [];

export const MAX_PRODUCT_IDS = 24;
const PRODUCT_ID = /^prod_[A-Za-z0-9]+$/;
const KEY = "product_ids";

const invalid = (message: string) =>
  new MedusaError(MedusaError.Types.INVALID_DATA, message, "invalid_product_ids");

/**
 * Strict query for the anonymous product routes: exactly one `product_ids` key with
 * 1 to 24 unique comma separated ids that look like product ids. Any other key is refused.
 * Reads the address, as the store guard does, so it does not depend on earlier parsing.
 */
export function parseProductIdsQuery(req: { originalUrl?: string; url?: string }): string[] {
  const params = new URL(req.originalUrl ?? req.url ?? "/", "http://localhost").searchParams;
  for (const key of params.keys()) {
    if (key !== KEY) {
      throw invalid("Only product_ids is accepted.");
    }
  }
  const values = params.getAll(KEY);
  if (values.length !== 1) {
    throw invalid("Send product_ids once.");
  }
  const ids = values[0].split(",").map((id) => id.trim());
  if (ids.length === 0 || ids.some((id) => id === "")) {
    throw invalid("Send between 1 and 24 product ids.");
  }
  if (ids.length > MAX_PRODUCT_IDS) {
    throw invalid("Send between 1 and 24 product ids.");
  }
  if (new Set(ids).size !== ids.length) {
    throw invalid("Each product id may appear once.");
  }
  if (ids.some((id) => !PRODUCT_ID.test(id))) {
    throw invalid("A product id is not valid.");
  }
  return ids;
}
