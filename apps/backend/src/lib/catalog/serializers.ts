import type { MedusaContainer } from "@medusajs/framework/types";
import { defineAllowlistSerializer } from "../serializers";
import type { ContentSnapshot } from "./content-snapshot";
import { getCatalogService, getQuery, loadLiveSnapshotByProduct, loadOwnedSubmission } from "./load-content";

type Row = Record<string, any>;

export const vendorProductListSerializer = defineAllowlistSerializer({
  name: "vendor-product-list-item",
  audience: "vendor",
  shape: {
    id: true,
    title: true,
    state: true,
    is_live: true,
    has_pending: true,
    thumbnail: true,
    variant_count: true,
    updated_at: true,
  },
});

export const vendorProductDetailSerializer = defineAllowlistSerializer({
  name: "vendor-product-detail",
  audience: "vendor",
  shape: {
    id: true,
    state: true,
    is_live: true,
    has_pending: true,
    reason: true,
    revision: true,
    submitted_at: true,
    content: {
      title: true,
      description: true,
      images: { upload_id: true, url: true },
      options: { title: true },
      variants: {
        variant_id: true,
        vendor_sku: true,
        payout_price: true,
        mrp: true,
        net_quantity_value: true,
        net_quantity_unit: true,
        weight_g: true,
        length_mm: true,
        width_mm: true,
        height_mm: true,
      },
      proposed_category_id: true,
      proposed_gst_class: true,
      proposed_hsn: true,
      declaration: {
        generic_name: true,
        country_of_origin: true,
        packed_by_name: true,
        packed_by_address: true,
      },
    },
  },
});

export const vendorCategorySerializer = defineAllowlistSerializer({
  name: "vendor-category",
  audience: "vendor",
  shape: { id: true, name: true },
});

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const stringRecord = (value: unknown, allowedKeys: string[]): Record<string, string> =>
  Object.fromEntries(
    Object.entries((value ?? {}) as Record<string, unknown>).filter(
      ([key, item]) => allowedKeys.includes(key) && typeof item === "string"
    )
  ) as Record<string, string>;

/**
 * The detail view of one product. The option value lists and each variant's option map have
 * dynamic keys that a static allowlist cannot name, so they are copied back after the
 * serializer ran, limited to the option titles of the same content and to string values.
 */
export async function readProductDetail(
  scope: MedusaContainer,
  vendorId: string,
  productId: string
) {
  const submission = await loadOwnedSubmission(scope, vendorId, productId);
  const content = (submission.pending_changes ??
    (await loadLiveSnapshotByProduct(scope, productId))) as unknown as ContentSnapshot;

  const uploadIds = content.images.map((image) => image.upload_id);
  const uploads = uploadIds.length
    ? ((await getCatalogService(scope).listVendorUploads({ id: uploadIds }, { take: null })) as Row[])
    : [];
  const urlById = new Map(uploads.map((upload) => [String(upload.id), String(upload.url)]));

  const view = {
    id: submission.product_id,
    state: submission.state,
    is_live: submission.is_live,
    has_pending: Boolean(submission.pending_changes),
    reason: submission.reason ?? null,
    revision: submission.revision,
    submitted_at: submission.submitted_at ?? null,
    content: {
      ...content,
      images: content.images.map((image) => ({
        upload_id: image.upload_id,
        url: urlById.get(image.upload_id) ?? null,
      })),
    },
  };

  const serialized = vendorProductDetailSerializer.serialize(view) as Row;
  const titles = content.options.map((option) => option.title);
  serialized.content.options = ((serialized.content.options ?? []) as Row[]).map(
    (option, index) => ({ ...option, values: stringList(content.options[index]?.values) })
  );
  serialized.content.variants = ((serialized.content.variants ?? []) as Row[]).map(
    (variant, index) => ({
      ...variant,
      option_values: stringRecord(content.variants[index]?.option_values, titles),
    })
  );
  return { product: serialized };
}

export type ProductListQuery = {
  state?: string;
  q?: string;
  limit: number;
  offset: number;
};

// The title filter and paging run in memory over at most this many submissions.
const LIST_CAP = 2000;

export async function readProductList(
  scope: MedusaContainer,
  vendorId: string,
  query: ProductListQuery
) {
  const submissions = await getCatalogService(scope).listProductSubmissions(
    { vendor_id: vendorId, ...(query.state ? { state: query.state } : {}) } as never,
    { take: LIST_CAP, order: { updated_at: "DESC" } }
  );
  const ids = submissions.map((submission) => String(submission.product_id));
  const coreById = new Map<string, Row>();
  if (ids.length > 0) {
    const { data } = await getQuery(scope).graph({
      entity: "product",
      fields: ["id", "title", "images.url", "images.rank", "variants.id"],
      filters: { id: ids },
    });
    for (const product of data) {
      coreById.set(String(product.id), product);
    }
  }
  const needle = query.q?.trim().toLowerCase();
  const rows = submissions
    .map((submission) => {
      const core = coreById.get(String(submission.product_id)) ?? {};
      const images = [...((core.images ?? []) as Row[])].sort(
        (x, y) => (x.rank ?? 0) - (y.rank ?? 0)
      );
      return {
        id: submission.product_id,
        title: core.title ?? "",
        state: submission.state,
        is_live: submission.is_live,
        has_pending: Boolean(submission.pending_changes),
        thumbnail: images[0]?.url ?? null,
        variant_count: ((core.variants ?? []) as Row[]).length,
        updated_at: submission.updated_at,
      };
    })
    .filter((row) => !needle || String(row.title).toLowerCase().includes(needle));
  const page = rows.slice(query.offset, query.offset + query.limit);
  return {
    products: vendorProductListSerializer.serializeMany(page),
    count: rows.length,
    limit: query.limit,
    offset: query.offset,
  };
}

const CATEGORY_CAP = 500;

export async function readCategories(scope: MedusaContainer) {
  const { data } = await getQuery(scope).graph({
    entity: "product_category",
    fields: ["id", "name"],
    filters: { is_active: true, is_internal: false },
    pagination: { take: CATEGORY_CAP, order: { name: "ASC" } },
  });
  return { categories: vendorCategorySerializer.serializeMany(data) };
}
