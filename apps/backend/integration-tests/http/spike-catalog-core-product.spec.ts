import { randomUUID } from "node:crypto";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createAndLinkProductOptionsToProductWorkflow,
  createProductVariantsWorkflow,
  createProductsWorkflow,
  deleteProductVariantsWorkflow,
  linkProductsToSalesChannelWorkflow,
  updateProductOptionValuesWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";
import { ensureGstProductTypes } from "../../src/lib/catalog/ensure-gst-types";
import { createPublishableKey } from "../helpers/publishable-key";
import {
  assertMedusaVersion,
  ensureBareDefaults,
  ensureStoreAndDefaultChannel,
  observe,
  recordSpike,
} from "../support/spike-fixtures";

jest.setTimeout(10 * 60 * 1000);

type Row = Record<string, any>;
type Query = { graph(config: Record<string, unknown>): Promise<{ data: Row[] }> };

const LAYOUT = "core";
const queryOf = (container: MedusaContainer) =>
  container.resolve(ContainerRegistrationKeys.QUERY) as unknown as Query;

// <RESOLVE: if a field name is rejected, run
//   pnpm -C apps/backend exec medusa exec ./src/scripts/print-product-fields.ts
// or read apps/backend/node_modules/@medusajs/core-flows/dist/product/workflows/create-products.d.ts>
const PRODUCT_FIELDS = [
  "id",
  "status",
  "handle",
  "metadata",
  "type_id",
  "origin_country",
  "tags.id",
  "sales_channels.id",
  "images.id",
  "images.url",
  "images.rank",
  "options.id",
  "options.title",
  "options.values.id",
  "options.values.value",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.hs_code",
  "variants.manage_inventory",
  "variants.options.value",
  "variants.options.option.title",
  "variants.price_set.prices.amount",
  "variants.inventory_items.inventory_item_id",
];

async function readProduct(container: MedusaContainer, id: string): Promise<Row | undefined> {
  const { data } = await queryOf(container).graph({
    entity: "product",
    fields: PRODUCT_FIELDS,
    filters: { id },
  });
  return data[0];
}

async function defaultProfileId(container: MedusaContainer): Promise<string> {
  const { data } = await queryOf(container).graph({
    entity: "shipping_profile",
    fields: ["id", "type"],
  });
  const profile = data.find((row) => row.type === "default") ?? data[0];
  return String(profile.id);
}

async function inventoryOf(container: MedusaContainer, product: Row) {
  const itemIds = (product.variants ?? []).flatMap((variant: Row) =>
    (variant.inventory_items ?? []).map((link: Row) => String(link.inventory_item_id))
  );
  if (itemIds.length === 0) {
    return { item_ids: [] as string[], level_count: 0 };
  }
  const { data } = await queryOf(container).graph({
    entity: "inventory_level",
    fields: ["id", "inventory_item_id"],
    filters: { inventory_item_id: itemIds },
  });
  return { item_ids: itemIds as string[], level_count: data.length };
}

// Records the names of the events the event bus saw since the last call.
function watchEvents(container: MedusaContainer) {
  const bus = container.resolve(Modules.EVENT_BUS) as unknown as {
    emit: (messages: unknown, options?: unknown) => Promise<unknown>;
  };
  const original = bus.emit.bind(bus);
  let names: string[] = [];
  bus.emit = async (messages: unknown, options?: unknown) => {
    for (const message of ([] as { name?: string }[]).concat(messages as never)) {
      if (message?.name) {
        names.push(message.name);
      }
    }
    return original(messages, options);
  };
  return {
    take(): string[] {
      const taken = names;
      names = [];
      return taken;
    },
    restore() {
      bus.emit = original;
    },
  };
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("core product behaviour", () => {
      it("records how the core product workflows behave", async () => {
        const container = getContainer();
        const version = assertMedusaVersion();
        recordSpike("C", "setup", "version", { version });
        expect(version).toBe("2.22.7");

        const { channelId } = await ensureStoreAndDefaultChannel(container);
        await ensureBareDefaults(container);
        const publishableKey = await createPublishableKey(container);
        const profileId = await defaultProfileId(container);
        const events = watchEvents(container);
        const storeHeaders = { "x-publishable-api-key": publishableKey };

        const storeVisibility = async (id: string) => {
          const list = await api.get("/store/products?fields=id&limit=100", {
            headers: storeHeaders,
            validateStatus: () => true,
          });
          const byId = await api.get(`/store/products/${id}?fields=id`, {
            headers: storeHeaders,
            validateStatus: () => true,
          });
          const listed = ((list.data?.products ?? []) as Row[]).some((p) => p.id === id);
          return { listed, list_status: list.status, by_id_status: byId.status };
        };

        const baseProduct = (handle: string, withPrices?: boolean) => ({
          title: "Spike Draft",
          handle,
          status: "draft",
          shipping_profile_id: profileId,
          options: [{ title: "Size", values: ["S", "M"] }],
          variants: ["S", "M"].map((size) => ({
            title: size,
            options: { Size: size },
            manage_inventory: true,
            allow_backorder: false,
            ...(withPrices ? { prices: [] } : {}),
          })),
        });

        // C1: create a draft without prices or SKU.
        let productId: string | undefined;
        let pricesFieldNeeded = false;
        const created = await observe("C", LAYOUT, "C1-create-without-prices", async () => {
          const { result } = await createProductsWorkflow(container).run({
            input: { products: [baseProduct(`draft-${randomUUID()}`)] as never },
          });
          productId = String((result as Row[])[0].id);
          return { ok: true, product_id: productId, events: events.take() };
        });
        if (!created) {
          // Retry with an empty prices array on each variant.
          await observe("C", LAYOUT, "C1b-create-with-empty-prices", async () => {
            const { result } = await createProductsWorkflow(container).run({
              input: {
                products: [baseProduct(`draft-${randomUUID()}`, true)] as never,
              },
            });
            productId = String((result as Row[])[0].id);
            pricesFieldNeeded = true;
            return { ok: true, product_id: productId, prices_field_needed: true };
          });
        }
        expect(productId).toBeDefined();
        const id = productId as string;

        await observe("C", LAYOUT, "C1c-read-back-and-visibility", async () => {
          const product = (await readProduct(container, id)) as Row;
          const inventory = await inventoryOf(container, product);
          return {
            prices_field_needed: pricesFieldNeeded,
            status: product.status,
            sales_channel_count: (product.sales_channels ?? []).length,
            metadata: product.metadata ?? null,
            tag_count: (product.tags ?? []).length,
            variant_skus: (product.variants ?? []).map((v: Row) => v.sku ?? null),
            price_row_count: (product.variants ?? []).reduce(
              (sum: number, v: Row) => sum + (v.price_set?.prices?.length ?? 0),
              0
            ),
            inventory_item_count: inventory.item_ids.length,
            inventory_level_count: inventory.level_count,
            store: await storeVisibility(id),
          };
        });

        // C2: structure updates (extend an option, add a variant, rename a value).
        // From 2.16, option values are linked per product. Extending values needs
        // createAndLinkProductOptionsToProductWorkflow; a bare updateProductOptionsWorkflow
        // values array does not make the new value usable on the product.
        const before = (await readProduct(container, id)) as Row;
        const sizeOption = (before.options ?? []).find((o: Row) => o.title === "Size") as Row;
        const [firstVariant, secondVariant] = before.variants as Row[];
        await observe("C", LAYOUT, "C2a-extend-option-and-add-variant", async () => {
          await createAndLinkProductOptionsToProductWorkflow(container).run({
            input: {
              product_id: id,
              update: [
                {
                  product_option_id: sizeOption.id,
                  add: [{ value: "L" }],
                },
              ],
            },
          });
          await createProductVariantsWorkflow(container).run({
            input: {
              product_variants: [
                {
                  product_id: id,
                  title: "L",
                  options: { Size: "L" },
                  manage_inventory: true,
                  allow_backorder: false,
                },
              ],
            } as never,
          });
          const after = (await readProduct(container, id)) as Row;
          const inventory = await inventoryOf(container, after);
          return {
            method:
              "createAndLinkProductOptionsToProductWorkflow then createProductVariantsWorkflow",
            option_values: (after.options ?? []).flatMap((o: Row) =>
              (o.values ?? []).map((v: Row) => v.value)
            ),
            variant_count: (after.variants ?? []).length,
            inventory_item_count: inventory.item_ids.length,
            variants_have_inventory_item: (after.variants ?? []).map(
              (v: Row) => (v.inventory_items ?? []).length
            ),
            kept_existing_variant_ids: [firstVariant.id, secondVariant.id].filter((vid) =>
              (after.variants ?? []).some((v: Row) => v.id === vid)
            ),
          };
        });
        await observe("C", LAYOUT, "C2b-update-leaving-a-variant-out", async () => {
          const current = (await readProduct(container, id)) as Row;
          const keep = (current.variants as Row[])[0];
          await updateProductsWorkflow(container).run({
            input: {
              selector: { id },
              update: { variants: [{ id: keep.id, title: keep.title }] } as never,
            },
          });
          const after = (await readProduct(container, id)) as Row;
          return {
            variant_count_before: current.variants.length,
            variant_count_after: (after.variants ?? []).length,
            omitted_variants_deleted:
              current.variants.length > (after.variants ?? []).length &&
              (after.variants ?? []).length === 1,
          };
        });
        await observe("C", LAYOUT, "C2c-rename-option-value", async () => {
          const current = (await readProduct(container, id)) as Row;
          const option = (current.options as Row[]).find((o) => o.title === "Size") as Row;
          const variants = current.variants as Row[];
          const currentValue = String(variants[0]?.options?.[0]?.value ?? "S");
          const valueRow = ((option.values ?? []) as Row[]).find(
            (v) => String(v.value) === currentValue
          );
          if (!valueRow?.id) {
            throw new Error(`Missing option value id for ${currentValue}`);
          }
          const renamedTo = `${currentValue}2`;
          await updateProductOptionValuesWorkflow(container).run({
            input: {
              id: String(valueRow.id),
              update: { value: renamedTo },
            },
          });
          const after = (await readProduct(container, id)) as Row;
          return {
            option_values: (after.options ?? []).flatMap((o: Row) =>
              (o.values ?? []).map((v: Row) => v.value)
            ),
            variant_option_values: (after.variants ?? []).map((v: Row) =>
              (v.options ?? []).map((o: Row) => o.value)
            ),
            renamed_from: currentValue,
            renamed_to: renamedTo,
          };
        });

        // C6 before C3 so at least one variant remains for hs_code.
        await observe("C", LAYOUT, "C6-type-origin-hs-code", async () => {
          const types = await ensureGstProductTypes(container);
          const current = (await readProduct(container, id)) as Row;
          const variant = (current.variants as Row[])[0];
          if (!variant) {
            throw new Error("No variant left for C6");
          }
          await updateProductsWorkflow(container).run({
            input: {
              selector: { id },
              update: {
                type_id: types["GST-5"],
                origin_country: "IN",
                variants: [{ id: variant.id, title: variant.title, hs_code: "6109" }],
              } as never,
            },
          });
          const after = (await readProduct(container, id)) as Row;
          return {
            type_matches: after.type_id === types["GST-5"],
            origin_country: after.origin_country ?? null,
            hs_codes: (after.variants ?? []).map((v: Row) => v.hs_code ?? null),
          };
        });

        // C3: variant deletion (after C6). Keep a second variant first so one remains for later steps.
        await observe("C", LAYOUT, "C3-prepare-two-variants", async () => {
          const current = (await readProduct(container, id)) as Row;
          if ((current.variants ?? []).length >= 2) {
            return { variant_count: current.variants.length, prepared: false };
          }
          const option = (current.options as Row[]).find((o) => o.title === "Size") as Row;
          const existing = String(current.variants?.[0]?.options?.[0]?.value ?? "S");
          const extra = existing.endsWith("2") ? "X" : `${existing}-extra`;
          await createAndLinkProductOptionsToProductWorkflow(container).run({
            input: {
              product_id: id,
              update: [{ product_option_id: option.id, add: [{ value: extra }] }],
            },
          });
          await createProductVariantsWorkflow(container).run({
            input: {
              product_variants: [
                {
                  product_id: id,
                  title: extra,
                  options: { Size: extra },
                  manage_inventory: true,
                  allow_backorder: false,
                },
              ],
            } as never,
          });
          const after = (await readProduct(container, id)) as Row;
          return { variant_count: (after.variants ?? []).length, prepared: true, extra };
        });
        await observe("C", LAYOUT, "C3-delete-variant", async () => {
          const current = (await readProduct(container, id)) as Row;
          const target = (current.variants as Row[])[0];
          const itemId = target.inventory_items?.[0]?.inventory_item_id as string | undefined;
          await deleteProductVariantsWorkflow(container).run({
            input: { ids: [target.id] } as never,
          });
          const after = (await readProduct(container, id)) as Row;
          let itemStillExists: boolean | null = null;
          let itemLinkedVariants: string[] | null = null;
          if (itemId) {
            const { data } = await queryOf(container).graph({
              entity: "inventory_item",
              fields: ["id", "variants.id"],
              filters: { id: itemId },
            });
            itemStillExists = data.length > 0;
            itemLinkedVariants = (data[0]?.variants ?? []).map((v: Row) => v.id);
          }
          return {
            variant_count_before: current.variants.length,
            variant_count_after: (after.variants ?? []).length,
            inventory_item_still_exists: itemStillExists,
            inventory_item_linked_variants: itemLinkedVariants,
          };
        });

        // C4: images and their order.
        const urlA = "https://files.example.test/products/aaaa.webp";
        const urlB = "https://files.example.test/products/bbbb.webp";
        const imageOrder = async () => {
          const product = (await readProduct(container, id)) as Row;
          return [...(product.images ?? [])]
            .sort((x: Row, y: Row) => (x.rank ?? 0) - (y.rank ?? 0))
            .map((image: Row) => image.url as string);
        };
        await observe("C", LAYOUT, "C4a-set-two-images", async () => {
          await updateProductsWorkflow(container).run({
            input: {
              selector: { id },
              update: { images: [{ url: urlA }, { url: urlB }] } as never,
            },
          });
          return { order: await imageOrder() };
        });
        await observe("C", LAYOUT, "C4b-reorder-images", async () => {
          await updateProductsWorkflow(container).run({
            input: {
              selector: { id },
              update: { images: [{ url: urlB }, { url: urlA }] } as never,
            },
          });
          return { order: await imageOrder(), expected_first: urlB };
        });

        // C5: publish, unlink and relink, with the event names each one emits.
        // Export name on 2.22.7 is linkProductsToSalesChannelWorkflow (not batchLink*).
        events.take();
        await observe("C", LAYOUT, "C5a-publish-with-channel", async () => {
          await updateProductsWorkflow(container).run({
            input: {
              selector: { id },
              update: { status: "published", sales_channels: [{ id: channelId }] } as never,
            },
          });
          return { events: events.take(), store: await storeVisibility(id) };
        });
        await observe("C", LAYOUT, "C5b-unlink-from-channel", async () => {
          await linkProductsToSalesChannelWorkflow(container).run({
            input: { id: channelId, remove: [id] },
          });
          return { events: events.take(), store: await storeVisibility(id) };
        });
        await observe("C", LAYOUT, "C5c-relink-to-channel", async () => {
          await linkProductsToSalesChannelWorkflow(container).run({
            input: { id: channelId, add: [id] },
          });
          return { events: events.take(), store: await storeVisibility(id) };
        });

        events.restore();
      });
    });
  },
});
