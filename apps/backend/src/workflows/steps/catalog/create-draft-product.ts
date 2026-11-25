import { randomUUID } from "node:crypto";
import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  createProductsWorkflow,
  deleteInventoryItemWorkflow,
  deleteProductsWorkflow,
} from "@medusajs/medusa/core-flows";
import type { ContentSnapshot } from "../../../lib/catalog/content-snapshot";
import {
  contentVariantPairs,
  coreVariantPairs,
  DEFAULT_OPTION_TITLE,
  DEFAULT_OPTION_VALUE,
  getQuery,
  pairsKey,
} from "../../../lib/catalog/load-content";

// Set to true when the recorded core behaviour says variants cannot be created without a
// prices field. The core variants then get an empty list, never a price.
const REQUIRE_EMPTY_PRICES = false;

export type CreateDraftProductInput = {
  content: ContentSnapshot;
  image_urls: string[];
};

export type DraftProduct = {
  id: string;
  /** Core variants with their option combination key, to match them to the payload. */
  variants: { id: string; key: string }[];
  inventory_item_ids: string[];
};

type Row = Record<string, any>;

/**
 * Creates the core product for a draft: fixed field set only. Never a vendor-supplied
 * status, channel, metadata, tag, handle, SKU or price.
 */
export const createDraftProductStep = createStep(
  "create-draft-product",
  async (input: CreateDraftProductInput, { container }) => {
    const { content } = input;
    const query = getQuery(container);

    const { data: profiles } = await query.graph({
      entity: "shipping_profile",
      fields: ["id", "type"],
    });
    const profile = profiles.find((row) => row.type === "default") ?? profiles[0];
    if (!profile) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "No shipping profile exists. Run the setup script first."
      );
    }

    const options =
      content.options.length > 0
        ? content.options.map((option) => ({ title: option.title, values: [...option.values] }))
        : [{ title: DEFAULT_OPTION_TITLE, values: [DEFAULT_OPTION_VALUE] }];

    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: content.title,
            description: content.description,
            handle: `draft-${randomUUID()}`,
            status: "draft",
            shipping_profile_id: profile.id,
            images: input.image_urls.map((url) => ({ url })),
            options,
            variants: content.variants.map((variant) => ({
              title: contentVariantPairs(content, variant)
                .map(([, value]) => value)
                .join(" / "),
              options: Object.fromEntries(contentVariantPairs(content, variant)),
              manage_inventory: true,
              allow_backorder: false,
              weight: variant.weight_g,
              length: variant.length_mm,
              width: variant.width_mm,
              height: variant.height_mm,
              ...(REQUIRE_EMPTY_PRICES ? { prices: [] } : {}),
            })),
          },
        ],
      } as never,
    });
    const productId = String((result as Row[])[0].id);

    const { data } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "variants.id",
        "variants.options.value",
        "variants.options.option.title",
        "variants.inventory_items.inventory_item_id",
      ],
      filters: { id: productId },
    });
    const variants = ((data[0]?.variants ?? []) as Row[]).map((variant) => ({
      id: String(variant.id),
      key: pairsKey(coreVariantPairs(variant)),
    }));
    const inventoryItemIds = ((data[0]?.variants ?? []) as Row[]).flatMap((variant) =>
      ((variant.inventory_items ?? []) as Row[]).map((link) => String(link.inventory_item_id))
    );

    const draft: DraftProduct = { id: productId, variants, inventory_item_ids: inventoryItemIds };
    return new StepResponse(draft, { product_id: productId, inventory_item_ids: inventoryItemIds });
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return;
    }
    await deleteProductsWorkflow(container).run({ input: { ids: [compensation.product_id] } });
    if (compensation.inventory_item_ids.length > 0) {
      await deleteInventoryItemWorkflow(container).run({
        input: compensation.inventory_item_ids as never,
      });
    }
  }
);
