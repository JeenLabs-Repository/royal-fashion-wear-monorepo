import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import {
  createAndLinkProductOptionsToProductWorkflow,
  createProductVariantsWorkflow,
  deleteProductVariantsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";
import type { ContentSnapshot } from "./content-snapshot";
import { catalogError } from "./errors";
import {
  contentVariantPairs,
  coreVariantPairs,
  DEFAULT_OPTION_TITLE,
  DEFAULT_OPTION_VALUE,
  getCatalogService,
  pairsKey,
  readCoreProduct,
} from "./load-content";

type Row = Record<string, any>;

export type ApplyContentInput = {
  productId: string;
  content: ContentSnapshot;
  /** Image URLs in display order, as returned by the reference check. */
  imageUrls: string[];
};

export type ApplyContentResult = {
  /** Core variant id of every variant that was created, keyed by its vendor SKU. */
  createdVariantIds: Record<string, string>;
};

const variantTitle = (content: ContentSnapshot, variant: ContentSnapshot["variants"][number]) =>
  contentVariantPairs(content, variant)
    .map(([, value]) => value)
    .join(" / ");

/**
 * Writes a content snapshot onto a core product through core workflows only, then upserts
 * the vendor variant references, the declaration and the upload ownership rows. It writes
 * content fields only: never the status, the channel links, prices, SKUs or the handle.
 * Those belong to approval.
 *
 * Option values are linked per product (Medusa 2.16+). New values go through
 * createAndLinkProductOptionsToProductWorkflow; new variants go through
 * createProductVariantsWorkflow. A variants array on updateProductsWorkflow replaces the
 * full list and deletes omitted rows, so kept variants are always sent by id.
 */
export async function applyContentToProduct(
  scope: MedusaContainer,
  input: ApplyContentInput
): Promise<ApplyContentResult> {
  const { productId, content, imageUrls } = input;
  const service = getCatalogService(scope);

  const [submission] = await service.listProductSubmissions({ product_id: productId }, { take: 1 });
  if (!submission) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
  }
  const vendorId = String(submission.vendor_id);
  const product = await readCoreProduct(scope, productId);
  const refs = (await service.listVendorVariantRefs({ product_id: productId }, { take: null })) as Row[];
  const existingVariants = (product.variants ?? []) as Row[];
  const existingIds = new Set(existingVariants.map((variant) => String(variant.id)));

  const wanted =
    content.options.length > 0
      ? content.options.map((option) => ({ title: option.title, values: [...option.values] }))
      : [{ title: DEFAULT_OPTION_TITLE, values: [DEFAULT_OPTION_VALUE] }];
  const existingOptions = new Map(
    ((product.options ?? []) as Row[]).map((option) => [String(option.title), option])
  );
  for (const title of existingOptions.keys()) {
    if (!wanted.some((option) => option.title === title)) {
      throw catalogError("validation_failed", "An option cannot be removed from a product.", {
        issues: [{ path: "options", message: `Option "${title}" cannot be removed.` }],
      });
    }
  }

  // Link any new option values to this product before variants reference them.
  const optionUpdates: { product_option_id: string; add: { value: string }[] }[] = [];
  for (const option of wanted) {
    const existing = existingOptions.get(option.title);
    if (!existing) {
      await createAndLinkProductOptionsToProductWorkflow(scope).run({
        input: {
          product_id: productId,
          add: [{ title: option.title, values: option.values }],
        },
      });
      continue;
    }
    const linked = new Set(
      ((existing.values ?? []) as Row[]).map((value) => String(value.value))
    );
    const missing = option.values.filter((value) => !linked.has(value));
    if (missing.length > 0) {
      optionUpdates.push({
        product_option_id: String(existing.id),
        add: missing.map((value) => ({ value })),
      });
    }
  }
  if (optionUpdates.length > 0) {
    await createAndLinkProductOptionsToProductWorkflow(scope).run({
      input: { product_id: productId, update: optionUpdates },
    });
  }

  for (const variant of content.variants) {
    if (variant.variant_id && !existingIds.has(String(variant.variant_id))) {
      throw catalogError("unknown_variant", "A variant does not belong to this product.", {
        issues: [{ path: "variants", message: "Unknown variant id." }],
      });
    }
  }
  const keptIds = new Set(content.variants.map((variant) => variant.variant_id).filter(Boolean));
  const removedIds = [...existingIds].filter((variantId) => !keptIds.has(variantId));
  if (removedIds.length > 0) {
    await deleteProductVariantsWorkflow(scope).run({ input: { ids: removedIds } as never });
  }

  const existingContentVariants = content.variants.filter((variant) => variant.variant_id);
  const newContentVariants = content.variants.filter((variant) => !variant.variant_id);

  await updateProductsWorkflow(scope).run({
    input: {
      selector: { id: productId },
      update: {
        title: content.title,
        description: content.description,
        images: imageUrls.map((url) => ({ url })),
        ...(existingContentVariants.length > 0
          ? {
              variants: existingContentVariants.map((variant) => ({
                id: variant.variant_id,
                title: variantTitle(content, variant),
                options: Object.fromEntries(contentVariantPairs(content, variant)),
                manage_inventory: true,
                allow_backorder: false,
                weight: variant.weight_g ?? null,
                length: variant.length_mm ?? null,
                width: variant.width_mm ?? null,
                height: variant.height_mm ?? null,
              })),
            }
          : {}),
      } as never,
    },
  });

  if (newContentVariants.length > 0) {
    await createProductVariantsWorkflow(scope).run({
      input: {
        product_variants: newContentVariants.map((variant) => ({
          product_id: productId,
          title: variantTitle(content, variant),
          options: Object.fromEntries(contentVariantPairs(content, variant)),
          manage_inventory: true,
          allow_backorder: false,
          weight: variant.weight_g ?? undefined,
          length: variant.length_mm ?? undefined,
          width: variant.width_mm ?? undefined,
          height: variant.height_mm ?? undefined,
        })),
      } as never,
    });
  }

  const updated = await readCoreProduct(scope, productId);
  const createdByKey = new Map<string, string>();
  for (const core of (updated.variants ?? []) as Row[]) {
    if (!existingIds.has(String(core.id))) {
      createdByKey.set(pairsKey(coreVariantPairs(core)), String(core.id));
    }
  }
  const createdVariantIds: Record<string, string> = {};
  for (const variant of newContentVariants) {
    const created = createdByKey.get(pairsKey(contentVariantPairs(content, variant)));
    if (!created) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "A created variant was not found after the update."
      );
    }
    createdVariantIds[variant.vendor_sku] = created;
  }

  const removedRefIds = refs
    .filter((ref) => removedIds.includes(String(ref.variant_id)))
    .map((ref) => String(ref.id));
  if (removedRefIds.length > 0) {
    await service.softDeleteVendorVariantRefs(removedRefIds);
  }
  const refByVariant = new Map(refs.map((ref) => [String(ref.variant_id), ref]));
  const toUpdate: Row[] = [];
  const toCreate: Row[] = [];
  for (const variant of content.variants) {
    const variantId = String(variant.variant_id ?? createdVariantIds[variant.vendor_sku]);
    const fields = {
      vendor_sku: variant.vendor_sku,
      payout_price: variant.payout_price,
      mrp: variant.mrp ?? null,
      net_quantity_value: variant.net_quantity_value ?? null,
      net_quantity_unit: variant.net_quantity_unit ?? null,
    };
    const existing = refByVariant.get(variantId);
    if (existing) {
      toUpdate.push({ id: existing.id, ...fields });
    } else {
      toCreate.push({ variant_id: variantId, product_id: productId, vendor_id: vendorId, ...fields });
    }
  }
  if (toUpdate.length > 0) {
    await service.updateVendorVariantRefs(toUpdate);
  }
  if (toCreate.length > 0) {
    await service.createVendorVariantRefs(toCreate);
  }

  const declaration = {
    generic_name: content.declaration?.generic_name ?? null,
    country_of_origin: content.declaration?.country_of_origin ?? null,
    packed_by_name: content.declaration?.packed_by_name ?? null,
    packed_by_address: content.declaration?.packed_by_address ?? null,
  };
  const [existingDeclaration] = (await service.listProductDeclarations(
    { product_id: productId },
    { take: 1 }
  )) as Row[];
  if (existingDeclaration) {
    await service.updateProductDeclarations({ id: existingDeclaration.id, ...declaration });
  } else {
    await service.createProductDeclarations([
      { product_id: productId, vendor_id: vendorId, ...declaration },
    ]);
  }

  const uploadIds = content.images.map((image) => image.upload_id);
  const attached = (await service.listVendorUploads({ product_id: productId }, { take: null })) as Row[];
  const released = attached.filter((upload) => !uploadIds.includes(String(upload.id)));
  if (released.length > 0) {
    await service.updateVendorUploads(released.map((upload) => ({ id: upload.id, product_id: null })));
  }
  await service.updateVendorUploads(uploadIds.map((id) => ({ id, product_id: productId })));

  return { createdVariantIds };
}
