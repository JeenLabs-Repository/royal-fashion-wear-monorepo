import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { buildHandle, formatPlatformSku } from "../../../lib/catalog/ids";
import { getCatalogService, getQuery } from "../../../lib/catalog/load-content";

const HANDLE_ATTEMPTS = 5;

export type AssignPlatformIdentifiersInput = {
  product_id: string;
  title: string;
  /** True for a first approval; a live edit never touches the handle. */
  assign_handle: boolean;
};

type Row = Record<string, any>;

/**
 * Allocates the identifiers customers see. A new product gets a handle (slug plus five random
 * characters, drawn again up to five times when it is taken). Every variant without a SKU gets
 * the next platform SKU, so a live edit numbers only its new variants. There is no
 * compensation: the counter is never rolled back and gaps are fine.
 */
export const assignPlatformIdentifiersStep = createStep(
  "assign-platform-identifiers",
  async (input: AssignPlatformIdentifiersInput, { container }) => {
    const query = getQuery(container);

    let handle: string | null = null;
    if (input.assign_handle) {
      for (let attempt = 0; attempt < HANDLE_ATTEMPTS && handle === null; attempt += 1) {
        const candidate = buildHandle(input.title);
        const { data } = await query.graph({
          entity: "product",
          fields: ["id"],
          filters: { handle: candidate },
        });
        if (data.length === 0) {
          handle = candidate;
        }
      }
      if (handle === null) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "No free product handle was found after several attempts."
        );
      }
    }

    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "sku", "variant_rank"],
      filters: { product_id: input.product_id },
    });
    const service = getCatalogService(container);
    const skus: Record<string, string> = {};
    const unassigned = (variants as Row[])
      .filter((variant) => !variant.sku)
      .sort((x, y) => (x.variant_rank ?? 0) - (y.variant_rank ?? 0));
    for (const variant of unassigned) {
      skus[String(variant.id)] = formatPlatformSku(await service.nextSkuNumber());
    }
    return new StepResponse({ handle, skus });
  }
);
