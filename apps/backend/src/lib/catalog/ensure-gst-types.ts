import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createProductTypesWorkflow } from "@medusajs/medusa/core-flows";

export const GST_PRODUCT_TYPE_VALUES = ["GST-0", "GST-5", "GST-18", "GST-40"] as const;

export type GstProductTypeValue = (typeof GST_PRODUCT_TYPE_VALUES)[number];

type Query = {
  graph: (input: {
    entity: string;
    fields: string[];
    filters: Record<string, unknown>;
  }) => Promise<{ data: { id: string; value: string }[] }>;
};

const readTypes = async (container: MedusaContainer): Promise<Record<string, string>> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as Query;
  const { data } = await query.graph({
    entity: "product_type",
    fields: ["id", "value"],
    filters: { value: [...GST_PRODUCT_TYPE_VALUES] },
  });
  return Object.fromEntries(data.map((type) => [type.value, type.id]));
};

/**
 * Makes sure one product type exists for each GST rate and returns a map from
 * value to product type id. Creates only the missing ones. Safe to run at the
 * same time as the seed that does the same: a failed create is followed by a
 * re-read, and the original error is thrown only if the type is still missing.
 */
export async function ensureGstProductTypes(
  container: MedusaContainer
): Promise<Record<GstProductTypeValue, string>> {
  let found = await readTypes(container);
  const missing = GST_PRODUCT_TYPE_VALUES.filter((value) => !found[value]);
  if (missing.length > 0) {
    try {
      await createProductTypesWorkflow(container).run({
        input: { product_types: missing.map((value) => ({ value })) },
      });
    } catch (error) {
      found = await readTypes(container);
      if (missing.some((value) => !found[value])) {
        throw error;
      }
    }
    found = await readTypes(container);
  }
  return found as Record<GstProductTypeValue, string>;
}
