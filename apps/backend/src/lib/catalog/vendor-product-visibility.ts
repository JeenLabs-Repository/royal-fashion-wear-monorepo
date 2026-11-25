import type { MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { linkProductsToSalesChannelWorkflow } from "@medusajs/medusa/core-flows";
import { getDefaultSalesChannelId } from "./default-sales-channel";
import { getCatalogService } from "./load-content";

// Decision 0021: unlink and relink already emit product.updated, so storefront
// revalidation needs no extra emit here.
const LINK_CHANGE_FIRES_PRODUCT_UPDATED = true;

type Options = { productIds?: string[] };

async function announce(scope: MedusaContainer, productIds: string[]): Promise<void> {
  if (LINK_CHANGE_FIRES_PRODUCT_UPDATED || productIds.length === 0) {
    return;
  }
  const bus = scope.resolve(Modules.EVENT_BUS) as {
    emit: (messages: { name: string; data: Record<string, unknown> }[]) => Promise<void>;
  };
  await bus.emit(productIds.map((id) => ({ name: "product.updated", data: { id } })));
}

/**
 * Takes every live product of a vendor off sale and marks it, so reactivation can put
 * back exactly these. Products that are not live are never touched. Idempotent: a product
 * already marked is skipped. Returns the product ids it changed.
 */
export async function hideVendorProducts(
  scope: MedusaContainer,
  vendorId: string,
  options: Options = {}
): Promise<string[]> {
  const service = getCatalogService(scope);
  const filters: Record<string, unknown> = {
    vendor_id: vendorId,
    is_live: true,
    hidden_by_suspension: false,
  };
  if (options.productIds) {
    filters.product_id = options.productIds;
  }
  const rows = await service.listProductSubmissions(filters, { take: null });
  if (rows.length === 0) {
    return [];
  }
  const productIds = rows.map((row) => String(row.product_id));
  const channelId = await getDefaultSalesChannelId(scope);

  await linkProductsToSalesChannelWorkflow(scope).run({
    input: { id: channelId, remove: productIds },
  });
  await service.updateProductSubmissions(
    rows.map((row) => ({ id: row.id, hidden_by_suspension: true }))
  );
  await announce(scope, productIds);
  return productIds;
}

/**
 * Puts back the products that a suspension took off sale and clears the mark, with no
 * new review: the approved content is untouched. Idempotent. Returns the ids it changed.
 */
export async function restoreVendorProducts(
  scope: MedusaContainer,
  vendorId: string,
  options: Options = {}
): Promise<string[]> {
  const service = getCatalogService(scope);
  const filters: Record<string, unknown> = {
    vendor_id: vendorId,
    is_live: true,
    hidden_by_suspension: true,
  };
  if (options.productIds) {
    filters.product_id = options.productIds;
  }
  const rows = await service.listProductSubmissions(filters, { take: null });
  if (rows.length === 0) {
    return [];
  }
  const productIds = rows.map((row) => String(row.product_id));
  const channelId = await getDefaultSalesChannelId(scope);

  await linkProductsToSalesChannelWorkflow(scope).run({
    input: { id: channelId, add: productIds },
  });
  await service.updateProductSubmissions(
    rows.map((row) => ({ id: row.id, hidden_by_suspension: false }))
  );
  await announce(scope, productIds);
  return productIds;
}
