import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { variantHasOpenAssignment } from "../../../lib/catalog/assignment-guard";
import type { ContentSnapshot } from "../../../lib/catalog/content-snapshot";
import { catalogError } from "../../../lib/catalog/errors";
import { getQuery, loadLiveSnapshotByProduct } from "../../../lib/catalog/load-content";

export type CheckVariantRemovalInput = {
  product_id: string;
  /** The proposed content, with `variant_id` filled for variants that already exist. */
  content: ContentSnapshot;
};

type Row = Record<string, any>;

/**
 * A variant that exists in the live content and is missing from the proposed content is a
 * removal. A removal is refused while the variant holds stock, has a reservation or has an
 * open assignment. The error lists the vendor SKUs of the offending variants.
 */
export const checkVariantRemovalStep = createStep(
  "check-variant-removal",
  async (input: CheckVariantRemovalInput, { container }) => {
    const live = await loadLiveSnapshotByProduct(container, input.product_id);
    const kept = new Set(input.content.variants.map((variant) => variant.variant_id).filter(Boolean));
    const removed = live.variants.filter(
      (variant) => variant.variant_id && !kept.has(variant.variant_id)
    );
    const query = getQuery(container);
    const offenders: string[] = [];

    for (const variant of removed) {
      const variantId = String(variant.variant_id);
      const { data } = await query.graph({
        entity: "product_variant",
        fields: ["id", "inventory_items.inventory_item_id"],
        filters: { id: variantId },
      });
      const itemIds = ((data[0]?.inventory_items ?? []) as Row[]).map((link) =>
        String(link.inventory_item_id)
      );
      let held = false;
      if (itemIds.length > 0) {
        const levels = await query.graph({
          entity: "inventory_level",
          fields: ["id", "stocked_quantity", "reserved_quantity"],
          filters: { inventory_item_id: itemIds },
        });
        held = levels.data.some(
          (level) => Number(level.stocked_quantity) > 0 || Number(level.reserved_quantity) > 0
        );
      }
      if (held || (await variantHasOpenAssignment(variantId))) {
        offenders.push(variant.vendor_sku);
      }
    }

    if (offenders.length > 0) {
      throw catalogError(
        "variant_has_stock_or_orders",
        `These variants have stock, reservations or open orders and cannot be removed: ${offenders.join(", ")}.`,
        { skus: offenders }
      );
    }
    return new StepResponse({ removed: removed.length });
  }
);
