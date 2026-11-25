import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { VENDOR_CATALOG_MODULE } from "../../modules/vendor-catalog";
import type VendorCatalogService from "../../modules/vendor-catalog/service";
import { assertOwns } from "../vendor/assert-owns";
import { contentHash, type ContentSnapshot } from "./content-snapshot";

type Row = Record<string, any>;
type Query = { graph(config: Record<string, unknown>): Promise<{ data: Row[] }> };
export type ContentVariant = ContentSnapshot["variants"][number];

export const DEFAULT_OPTION_TITLE = "Title";
export const DEFAULT_OPTION_VALUE = "Default";

export const PRODUCT_CONTENT_FIELDS = [
  "id",
  "title",
  "description",
  "images.id",
  "images.url",
  "images.rank",
  "options.id",
  "options.title",
  "options.values.id",
  "options.values.value",
  "variants.id",
  "variants.title",
  "variants.variant_rank",
  "variants.weight",
  "variants.length",
  "variants.width",
  "variants.height",
  "variants.options.value",
  "variants.options.option.title",
];

export const getCatalogService = (scope: MedusaContainer) =>
  scope.resolve<VendorCatalogService>(VENDOR_CATALOG_MODULE);

export const getQuery = (scope: MedusaContainer) =>
  scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as Query;

/**
 * Two-decimal rupee string from a stored decimal. Takes the raw decimal string kept with
 * the bignumber column, so no float rounding is involved.
 */
export function toTwoDecimals(raw: unknown): string | undefined {
  const source =
    raw !== null && typeof raw === "object" && "value" in (raw as object)
      ? (raw as { value: unknown }).value
      : raw;
  if (source === null || source === undefined || source === "") {
    return undefined;
  }
  const [whole, fraction = ""] = String(source).split(".");
  return `${whole}.${`${fraction}00`.slice(0, 2)}`;
}

const compact = <T extends Record<string, unknown>>(row: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== "")
  ) as Partial<T>;

export type OptionPair = [title: string, value: string];

const sortPairs = (pairs: OptionPair[]): OptionPair[] =>
  [...pairs].sort(([a], [b]) => a.localeCompare(b));

export const pairsKey = (pairs: OptionPair[]): string =>
  sortPairs(pairs)
    .map(([title, value]) => `${title}\u0001${value}`)
    .join("\u0002");

/** Option title and value pairs of a core variant. */
export const coreVariantPairs = (variant: Row): OptionPair[] =>
  sortPairs(
    ((variant.options ?? []) as Row[]).map(
      (option) => [String(option.option?.title), String(option.value)] as OptionPair
    )
  );

/** Option title and value pairs of a snapshot variant; no options means the default option. */
export function contentVariantPairs(content: ContentSnapshot, variant: ContentVariant): OptionPair[] {
  if (content.options.length === 0) {
    return [[DEFAULT_OPTION_TITLE, DEFAULT_OPTION_VALUE]];
  }
  const values = variant.option_values as unknown as Record<string, string>;
  return sortPairs(Object.entries(values).map(([title, value]) => [title, value] as OptionPair));
}

export async function readCoreProduct(scope: MedusaContainer, productId: string): Promise<Row> {
  const { data } = await getQuery(scope).graph({
    entity: "product",
    fields: PRODUCT_CONTENT_FIELDS,
    filters: { id: productId },
  });
  if (!data[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
  }
  return data[0];
}

const isDefaultOptionProduct = (product: Row): boolean => {
  const options = (product.options ?? []) as Row[];
  return (
    options.length === 1 &&
    options[0].title === DEFAULT_OPTION_TITLE &&
    (options[0].values ?? []).length === 1 &&
    options[0].values[0].value === DEFAULT_OPTION_VALUE
  );
};

/** The submission of a product, or the same 404 for an unknown product and another vendor's. */
export async function loadOwnedSubmission(
  scope: MedusaContainer,
  vendorId: string,
  productId: string
) {
  const [row] = await getCatalogService(scope).listProductSubmissions(
    { product_id: productId },
    { take: 1 }
  );
  const candidate: Record<string, unknown> | undefined = row ? { ...row } : undefined;
  assertOwns(vendorId, candidate);
  return row;
}

/**
 * Content of the product as it is in core right now (the draft for a draft, the live
 * content for an approved product), rebuilt from core, the vendor references, the
 * declaration and the upload rows.
 */
export async function loadLiveSnapshotByProduct(
  scope: MedusaContainer,
  productId: string
): Promise<ContentSnapshot> {
  const service = getCatalogService(scope);
  const product = await readCoreProduct(scope, productId);
  const [submission] = await service.listProductSubmissions({ product_id: productId }, { take: 1 });
  if (!submission) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
  }
  const refs = (await service.listVendorVariantRefs({ product_id: productId }, { take: null })) as Row[];
  const [declaration] = (await service.listProductDeclarations(
    { product_id: productId },
    { take: 1 }
  )) as Row[];

  const images = [...((product.images ?? []) as Row[])].sort(
    (x, y) => (x.rank ?? 0) - (y.rank ?? 0)
  );
  const urls = images.map((image) => String(image.url));
  const uploads = urls.length
    ? ((await service.listVendorUploads({ url: urls }, { take: null })) as Row[])
    : [];
  const uploadByUrl = new Map(uploads.map((upload) => [String(upload.url), String(upload.id)]));

  const isDefault = isDefaultOptionProduct(product);
  const refByVariant = new Map(refs.map((ref) => [String(ref.variant_id), ref]));
  const variants = [...((product.variants ?? []) as Row[])]
    .sort((x, y) => (x.variant_rank ?? 0) - (y.variant_rank ?? 0))
    .map((core) => {
      const ref = refByVariant.get(String(core.id));
      if (!ref) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "A product variant has no vendor reference."
        );
      }
      return compact({
        variant_id: core.id,
        vendor_sku: ref.vendor_sku,
        option_values: isDefault ? {} : Object.fromEntries(coreVariantPairs(core)),
        payout_price: toTwoDecimals(ref.raw_payout_price ?? ref.payout_price),
        mrp: toTwoDecimals(ref.raw_mrp ?? ref.mrp),
        net_quantity_value: ref.net_quantity_value,
        net_quantity_unit: ref.net_quantity_unit,
        weight_g: core.weight,
        length_mm: core.length,
        width_mm: core.width,
        height_mm: core.height,
      });
    });

  const snapshot = compact({
    title: product.title,
    description: product.description ?? "",
    images: images.map((image) => {
      const uploadId = uploadByUrl.get(String(image.url));
      if (!uploadId) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "A product image has no upload row."
        );
      }
      return { upload_id: uploadId };
    }),
    options: isDefault
      ? []
      : ((product.options ?? []) as Row[]).map((option) => ({
          title: option.title,
          values: ((option.values ?? []) as Row[]).map((value) => String(value.value)),
        })),
    variants,
    proposed_category_id: submission.proposed_category_id,
    proposed_gst_class: submission.proposed_gst_class,
    proposed_hsn: submission.proposed_hsn,
    declaration: compact({
      generic_name: declaration?.generic_name,
      country_of_origin: declaration?.country_of_origin,
      packed_by_name: declaration?.packed_by_name,
      packed_by_address: declaration?.packed_by_address,
    }),
  });
  return snapshot as unknown as ContentSnapshot;
}

export async function loadLiveSnapshot(scope: MedusaContainer, submissionId: string) {
  const [submission] = await getCatalogService(scope).listProductSubmissions(
    { id: submissionId },
    { take: 1 }
  );
  if (!submission) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
  }
  return loadLiveSnapshotByProduct(scope, submission.product_id);
}

/** The pending revision when there is one, else the live content. */
export async function loadEffectiveSnapshot(scope: MedusaContainer, submissionId: string) {
  const [submission] = await getCatalogService(scope).listProductSubmissions(
    { id: submissionId },
    { take: 1 }
  );
  if (!submission) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
  }
  if (submission.pending_changes) {
    return submission.pending_changes as unknown as ContentSnapshot;
  }
  return loadLiveSnapshotByProduct(scope, submission.product_id);
}

export const loadContentSnapshot = (
  scope: MedusaContainer,
  submissionId: string,
  options: { effective?: boolean } = {}
) =>
  options.effective ? loadEffectiveSnapshot(scope, submissionId) : loadLiveSnapshot(scope, submissionId);

/** Fills `variant_id` on proposed variants whose SKU matches a live variant. */
export function withLiveVariantIds(live: ContentSnapshot, proposed: ContentSnapshot): ContentSnapshot {
  const idBySku = new Map(live.variants.map((variant) => [variant.vendor_sku, variant.variant_id]));
  return {
    ...proposed,
    variants: proposed.variants.map((variant) =>
      variant.variant_id || !idBySku.get(variant.vendor_sku)
        ? variant
        : { ...variant, variant_id: idBySku.get(variant.vendor_sku) }
    ),
  } as ContentSnapshot;
}

/** Hash that ignores variant ids, so "no change" is judged on what the vendor controls. */
export function comparableHash(content: ContentSnapshot): string {
  return contentHash({
    ...content,
    variants: content.variants.map(({ variant_id: _id, ...rest }) => rest),
  } as unknown as ContentSnapshot);
}
