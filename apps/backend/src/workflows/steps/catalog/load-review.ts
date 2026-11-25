import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { contentHash } from "../../../lib/catalog/content-snapshot";
import { diffSnapshots, type DiffableSnapshot } from "../../../lib/catalog/diff";
import { loadEffectiveSnapshot, loadLiveSnapshot } from "../../../lib/catalog/load-content";
import { REVIEW_TABS, type ReviewTab } from "../../../lib/catalog/middlewares/reviews";
import {
  toDiffView,
  toReviewContentView,
  type ApproverEdit,
  type ReviewDetail,
  type ReviewListItem,
} from "../../../lib/catalog/review-serializers";
import { getCustomerIdentitySettings } from "../../../lib/settings/customer-identity";
import { VENDOR_CATALOG_MODULE } from "../../../modules/vendor-catalog";

export type SubmissionRow = {
  id: string;
  product_id: string;
  vendor_id: string;
  state: string;
  is_live: boolean;
  revision: number;
  content_hash: string;
  pending_changes: unknown;
  approver_edits: unknown;
  reason: string | null;
  submitted_at: Date | string | null;
  decided_at: Date | string | null;
};

type Order = Record<string, "ASC" | "DESC">;

// The generated service has its own method types; this is the slice the review
// code uses, so a signature drift shows up in one place.
export type CatalogApi = {
  retrieveProductSubmission(id: string): Promise<SubmissionRow>;
  listAndCountProductSubmissions(
    filters: Record<string, unknown>,
    config: { skip: number; take: number; order: Order }
  ): Promise<[SubmissionRow[], number]>;
  updateProductSubmissions(data: Record<string, unknown>): Promise<unknown>;
  listVendorUploads(filters: Record<string, unknown>): Promise<{ id: string; url: string }[]>;
  listVendorVariantRefs(
    filters: Record<string, unknown>
  ): Promise<{ variant_id: string; vendor_sku: string }[]>;
};

export const getCatalogApi = (container: MedusaContainer): CatalogApi =>
  container.resolve(VENDOR_CATALOG_MODULE) as unknown as CatalogApi;

// Queue definition. The two decision tabs sort by the time of the decision so
// the oldest decision is first; the two open tabs sort by submission time.
const TAB_CONFIG: Record<ReviewTab, { filters: Record<string, unknown>; order: Order }> = {
  new: {
    filters: { state: "submitted", is_live: false },
    order: { submitted_at: "ASC", id: "ASC" },
  },
  live_edits: {
    filters: { state: "submitted", is_live: true },
    order: { submitted_at: "ASC", id: "ASC" },
  },
  changes_requested: {
    filters: { state: "changes_requested" },
    order: { decided_at: "ASC", id: "ASC" },
  },
  rejected: {
    filters: { state: "rejected" },
    order: { decided_at: "ASC", id: "ASC" },
  },
};

export const isReviewTab = (value: string): value is ReviewTab =>
  (REVIEW_TABS as readonly string[]).includes(value);

export function tabOf(row: Pick<SubmissionRow, "state" | "is_live">): ReviewTab | null {
  if (row.state === "submitted") {
    return row.is_live ? "live_edits" : "new";
  }
  if (row.state === "changes_requested") {
    return "changes_requested";
  }
  if (row.state === "rejected") {
    return "rejected";
  }
  return null;
}

const queryOf = (container: MedusaContainer) => container.resolve(ContainerRegistrationKeys.QUERY);

async function loadProductTitles(
  container: MedusaContainer,
  productIds: string[]
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (productIds.length === 0) {
    return titles;
  }
  const { data } = await queryOf(container).graph({
    entity: "product",
    fields: ["id", "title"],
    filters: { id: productIds },
  });
  for (const product of data as { id: string; title: string }[]) {
    titles.set(product.id, product.title);
  }
  return titles;
}

/** Upload id to stored image URL for the given ids. */
export async function loadImageUrls(
  container: MedusaContainer,
  uploadIds: string[]
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (uploadIds.length === 0) {
    return urls;
  }
  const uploads = await getCatalogApi(container).listVendorUploads({ id: uploadIds });
  for (const upload of uploads) {
    urls.set(upload.id, upload.url);
  }
  return urls;
}

async function loadCategoryName(
  container: MedusaContainer,
  categoryId: string | null | undefined
): Promise<string | null> {
  if (!categoryId) {
    return null;
  }
  const { data } = await queryOf(container).graph({
    entity: "product_category",
    fields: ["id", "name"],
    filters: { id: categoryId },
  });
  return (data as { name: string }[])[0]?.name ?? null;
}

// RESOLVE: confirmed variants.prices.* in @medusajs/medusa query-config.js
async function loadLivePrices(
  container: MedusaContainer,
  productId: string
): Promise<{ vendor_sku: string; selling_price: string }[]> {
  const refs = await getCatalogApi(container).listVendorVariantRefs({ product_id: productId });
  const skuByVariant = new Map(refs.map((ref) => [ref.variant_id, ref.vendor_sku]));

  const { data } = await queryOf(container).graph({
    entity: "product",
    fields: ["id", "variants.id", "variants.prices.amount", "variants.prices.currency_code"],
    filters: { id: productId },
  });
  const product = (data as {
    variants?: { id: string; prices?: { amount: number; currency_code: string }[] }[];
  }[])[0];

  const rows: { vendor_sku: string; selling_price: string }[] = [];
  for (const variant of product?.variants ?? []) {
    const sku = skuByVariant.get(variant.id);
    const price = (variant.prices ?? []).find((entry) => entry.currency_code === "inr");
    if (sku && price) {
      rows.push({ vendor_sku: sku, selling_price: Number(price.amount).toFixed(2) });
    }
  }
  return rows.sort((a, b) => a.vendor_sku.localeCompare(b.vendor_sku));
}

export async function loadReviewList(
  container: MedusaContainer,
  input: { tab: ReviewTab; limit: number; offset: number }
): Promise<{ items: ReviewListItem[]; count: number }> {
  const config = TAB_CONFIG[input.tab];
  const [rows, count] = await getCatalogApi(container).listAndCountProductSubmissions(
    config.filters,
    { skip: input.offset, take: input.limit, order: config.order }
  );
  const titles = await loadProductTitles(
    container,
    rows.map((row) => row.product_id)
  );

  const items = rows.map((row) => {
    const pending = row.pending_changes as { title?: string } | null;
    return {
      id: row.id,
      product_id: row.product_id,
      title: pending?.title ?? titles.get(row.product_id) ?? "",
      state: row.state,
      is_live: row.is_live,
      has_pending: row.pending_changes !== null && row.pending_changes !== undefined,
      revision: row.revision,
      submitted_at: row.submitted_at,
      decided_at: row.decided_at,
      reason: row.reason,
    };
  });
  return { items, count };
}

const asApproverEdits = (value: unknown): ApproverEdit[] =>
  Array.isArray(value)
    ? value
        .filter(
          (entry): entry is ApproverEdit =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as ApproverEdit).field === "string"
        )
        .map((entry) => ({
          field: entry.field,
          before: String(entry.before ?? ""),
          after: String(entry.after ?? ""),
        }))
    : [];

async function readDisplayMode(container: MedusaContainer): Promise<string> {
  try {
    const settings = await getCustomerIdentitySettings(container);
    return settings.lm_display_mode;
  } catch (error) {
    // The review screen must open even when the settings card cannot be read.
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
    logger.warn(
      `[product-review] Could not read the customer identity settings: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return "hidden";
  }
}

/**
 * Everything the review screen needs for one submission. The `content_hash`
 * returned is the hash of the effective snapshot, which is what the decision
 * routes compare against.
 */
export async function loadReviewDetail(
  container: MedusaContainer,
  submissionId: string
): Promise<ReviewDetail> {
  const submission = await getCatalogApi(container).retrieveProductSubmission(submissionId);

  const effective = (await loadEffectiveSnapshot(container, submission.id)) as DiffableSnapshot;
  const live = submission.is_live
    ? ((await loadLiveSnapshot(container, submission.id)) as DiffableSnapshot)
    : null;

  const uploadIds = [...effective.images, ...(live?.images ?? [])].map((image) => image.upload_id);
  const urls = await loadImageUrls(container, [...new Set(uploadIds)]);

  const content = toReviewContentView(
    effective,
    urls,
    await loadCategoryName(
      container,
      typeof effective.proposed_category_id === "string" ? effective.proposed_category_id : null
    )
  );
  const liveContent = live
    ? toReviewContentView(
        live,
        urls,
        await loadCategoryName(
          container,
          typeof live.proposed_category_id === "string" ? live.proposed_category_id : null
        )
      )
    : null;

  return {
    id: submission.id,
    product_id: submission.product_id,
    state: submission.state,
    tab: tabOf(submission),
    is_live: submission.is_live,
    has_pending: submission.pending_changes !== null && submission.pending_changes !== undefined,
    revision: submission.revision,
    content_hash: contentHash(effective as never),
    reason: submission.reason,
    submitted_at: submission.submitted_at,
    decided_at: submission.decided_at,
    display_mode: await readDisplayMode(container),
    content,
    live_content: liveContent,
    diff: live ? toDiffView(diffSnapshots(live, effective)) : [],
    live_prices: submission.is_live ? await loadLivePrices(container, submission.product_id) : [],
    approver_edits: asApproverEdits(submission.approver_edits),
  };
}
