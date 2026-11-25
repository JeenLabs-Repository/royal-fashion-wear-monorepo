import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  linkProductsToSalesChannelWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";
import { assertEligible } from "../../../lib/catalog/assert-eligible";
import { contentHash } from "../../../lib/catalog/content-snapshot";
import { decisionError } from "../../../lib/catalog/decision-errors";
import { getDefaultSalesChannelId } from "../../../lib/catalog/default-sales-channel";
import { ensureGstProductTypes, type GstProductTypeValue } from "../../../lib/catalog/ensure-gst-types";
import { catalogError } from "../../../lib/catalog/errors";
import {
  getCatalogService,
  getQuery,
  loadEffectiveSnapshot,
  loadLiveSnapshotByProduct,
  toTwoDecimals,
} from "../../../lib/catalog/load-content";
import type { ApproveBody } from "../../../lib/catalog/middlewares/review-decisions";
import { compareDecimals, isRupees, parseRupees } from "../../../lib/catalog/money";
import { CHECKLIST_KEYS } from "../../../lib/catalog/review-checklist";
import { transition } from "../../../lib/catalog/state-machine";
import { stripTags } from "../../../lib/catalog/text";

type Row = Record<string, any>;

const CURRENCY = "inr";
// Widened so arbitrary request keys can be tested against the six literal keys.
const CHECKLIST_KEY_LIST: readonly string[] = CHECKLIST_KEYS;

export type DecisionEvent = "approve" | "reject" | "request_changes";

/** Lock key shared by every decision on one submission. */
export const decisionLockKey = (submissionId: string): string => `catalog-decision:${submissionId}`;

/**
 * Current customer price of every variant of a product in rupees with two decimals, keyed by
 * core variant id. A variant without an INR price is missing from the map.
 * <RESOLVE: confirm the field names with one graph call on product_variant that prints price_set.prices.amount and price_set.prices.currency_code. Command: grep -rn "price_set" apps/backend/node_modules/@medusajs/medusa/dist/api/admin/products/query-config.js | head>
 */
export async function readInrPrices(
  container: MedusaContainer,
  productId: string
): Promise<Map<string, string>> {
  const { data } = await getQuery(container).graph({
    entity: "product_variant",
    fields: ["id", "price_set.prices.amount", "price_set.prices.raw_amount", "price_set.prices.currency_code"],
    filters: { product_id: productId },
  });
  const prices = new Map<string, string>();
  for (const variant of data) {
    const price = ((variant.price_set?.prices ?? []) as Row[]).find(
      (candidate) => String(candidate.currency_code).toLowerCase() === CURRENCY
    );
    const amount = toTwoDecimals(price?.raw_amount ?? price?.amount);
    if (amount) {
      prices.set(String(variant.id), amount);
    }
  }
  return prices;
}

/** Maps selling prices keyed by vendor SKU to selling prices keyed by platform SKU. */
export function toPlatformPrices(
  sellingPrices: Record<string, string>,
  platformSkus: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sellingPrices).map(([vendorSku, amount]) => [platformSkus[vendorSku] ?? "unassigned", amount])
  );
}

type CoreView = {
  handle: string;
  status: string;
  type_id: string | null;
  origin_country: string | null;
  category_ids: string[];
  variants: { id: string; sku: string | null; hs_code: string | null }[];
};

async function readCoreView(container: MedusaContainer, productId: string): Promise<CoreView> {
  const { data } = await getQuery(container).graph({
    entity: "product",
    fields: [
      "id",
      "handle",
      "status",
      "type_id",
      "origin_country",
      "categories.id",
      "variants.id",
      "variants.sku",
      "variants.hs_code",
    ],
    filters: { id: productId },
  });
  const product = data[0];
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
  }
  return {
    handle: String(product.handle),
    status: String(product.status),
    type_id: product.type_id ? String(product.type_id) : null,
    origin_country: product.origin_country ? String(product.origin_country) : null,
    category_ids: ((product.categories ?? []) as Row[]).map((category) => String(category.id)),
    variants: ((product.variants ?? []) as Row[]).map((variant) => ({
      id: String(variant.id),
      sku: variant.sku ? String(variant.sku) : null,
      hs_code: variant.hs_code ? String(variant.hs_code) : null,
    })),
  };
}

export type LoadDecisionInput = {
  submission_id: string;
  content_hash: string;
  event: DecisionEvent;
  /** When set, the submission must be (or not be) live; approve picks its workflow from the flag. */
  live?: boolean;
};

/**
 * Loads the submission and refuses a decision that is not allowed from its position or that
 * was made on content other than the content now stored. Order: position, live flag, hash.
 */
export const loadDecisionStep = createStep(
  "load-catalog-decision",
  async (input: LoadDecisionInput, { container }) => {
    const [row] = (await getCatalogService(container).listProductSubmissions(
      { id: input.submission_id },
      { take: 1 }
    )) as Row[];
    if (!row) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
    }
    transition({ state: row.state, is_live: row.is_live } as never, input.event);
    if (input.live !== undefined && Boolean(row.is_live) !== input.live) {
      throw catalogError("invalid_transition", "The submission changed while the decision was prepared.");
    }
    // The hash the review detail returns: the hash of the effective snapshot, so a vendor or
    // approver edit after the page was opened makes this decision stale.
    const effective = await loadEffectiveSnapshot(container, String(row.id));
    if (contentHash(effective) !== input.content_hash) {
      throw decisionError(
        "stale_revision",
        "The content changed after you opened it. Reload the page and review it again."
      );
    }
    return new StepResponse({
      submission_id: String(row.id),
      product_id: String(row.product_id),
      vendor_id: String(row.vendor_id),
      revision: Number(row.revision),
      state: String(row.state),
      is_live: Boolean(row.is_live),
      proposed_category_id: (row.proposed_category_id as string | null) ?? null,
      proposed_gst_class: String(row.proposed_gst_class),
      proposed_hsn: (row.proposed_hsn as string | null) ?? null,
      approver_edits: (row.approver_edits as unknown[] | null) ?? [],
    });
  }
);

/** Approval only: a vendor that is suspended or whose agreement is stale blocks the decision. */
export const assertDecisionEligibleStep = createStep(
  "assert-decision-eligible",
  async (input: { vendor_id: string }, { container }) => {
    await assertEligible(container, input.vendor_id);
    return new StepResponse(true);
  }
);

export type ValidateApprovalInput = {
  submission_id: string;
  product_id: string;
  live: boolean;
  body: ApproveBody;
};

/**
 * Everything that can be refused is refused here, before any write: checklist, category,
 * price list and the MRP rule. Returns the data the write steps and the audit entry need.
 */
export const validateApprovalStep = createStep(
  "validate-catalog-approval",
  async (input: ValidateApprovalInput, { container }) => {
    const { body } = input;

    const checklist = (body.checklist ?? {}) as Record<string, unknown>;
    const notTicked = CHECKLIST_KEY_LIST.filter((key) => checklist[key] !== true);
    const unknownKeys = Object.keys(checklist).filter((key) => !CHECKLIST_KEY_LIST.includes(key));
    if (notTicked.length > 0 || unknownKeys.length > 0) {
      throw decisionError("checklist_incomplete", "Every anonymity check must be ticked before approval.", {
        missing: notTicked,
      });
    }

    const { data: categories } = await getQuery(container).graph({
      entity: "product_category",
      fields: ["id"],
      filters: { id: body.category_id, is_active: true, is_internal: false },
    });
    if (categories.length === 0) {
      throw catalogError("unknown_category", "Choose a category from the list.", {
        issues: [{ path: "category_id", message: "Choose a category from the list." }],
      });
    }

    // A live edit approves the pending revision; a new product approves what core holds now.
    const effective = await loadEffectiveSnapshot(container, input.submission_id);
    const variants = effective.variants;
    const knownSkus = new Set(variants.map((variant) => variant.vendor_sku));

    const overrides = new Map<string, string>();
    const issues: { path: string; message: string }[] = [];
    body.prices.forEach((entry, index) => {
      if (!knownSkus.has(entry.vendor_sku)) {
        issues.push({ path: `prices.${index}.vendor_sku`, message: "Unknown vendor SKU." });
      } else if (overrides.has(entry.vendor_sku)) {
        issues.push({ path: `prices.${index}.vendor_sku`, message: "Give one price per SKU." });
      } else if (!isRupees(entry.selling_price)) {
        issues.push({
          path: `prices.${index}.selling_price`,
          message: "Enter an amount from 0.01 to 999,999.99 with at most two decimals.",
        });
      } else {
        overrides.set(entry.vendor_sku, parseRupees(entry.selling_price));
      }
    });
    if (issues.length > 0) {
      throw catalogError("validation_failed", "The request has invalid fields.", { issues });
    }

    // Existing variants of a live product keep their price unless an override is given.
    const current = input.live ? await readInrPrices(container, input.product_id) : new Map<string, string>();
    const effectivePrices = new Map<string, string>();
    const missing: string[] = [];
    for (const variant of variants) {
      const chosen =
        overrides.get(variant.vendor_sku) ??
        (variant.variant_id ? current.get(String(variant.variant_id)) : undefined);
      if (chosen) {
        effectivePrices.set(variant.vendor_sku, chosen);
      } else {
        missing.push(variant.vendor_sku);
      }
    }
    if (missing.length > 0) {
      throw decisionError("price_missing", `Set a selling price for: ${missing.join(", ")}.`, {
        skus: missing,
      });
    }

    const above = variants.find(
      (variant) =>
        variant.mrp !== undefined &&
        compareDecimals(effectivePrices.get(variant.vendor_sku) as string, variant.mrp) === 1
    );
    if (above) {
      throw decisionError(
        "price_above_mrp",
        `The selling price of ${above.vendor_sku} is above its MRP.`,
        { sku: above.vendor_sku }
      );
    }

    return new StepResponse({
      title: effective.title,
      origin_country: effective.declaration?.country_of_origin ?? null,
      prices_by_sku: Object.fromEntries(overrides),
      selling_prices: Object.fromEntries(effectivePrices),
    });
  }
);

export type WriteApprovalInput = {
  product_id: string;
  /** New products only; a live edit never changes the handle. */
  handle: string | null;
  /** New products only; a live edit never changes the status. */
  publish: boolean;
  gst_class: GstProductTypeValue;
  hsn: string;
  category_id: string;
  origin_country: string | null;
  /** Newly allocated platform SKUs keyed by core variant id. */
  skus: Record<string, string>;
  /** Selling prices to write, keyed by vendor SKU. */
  prices_by_sku: Record<string, string>;
};

type WriteCompensation = {
  product_id: string;
  before: CoreView;
  previous_prices: [string, string][];
};

/**
 * The one place approval writes to the core product, through the core update workflow: the
 * product type (GST class), the HS code of every variant, category, origin country, prices and
 * newly allocated SKUs, plus handle and published status for a new product. Core `metadata`
 * is never written.
 * <RESOLVE: updateProductsWorkflow accepts `categories: [{ id }]`, `type_id`, `origin_country`, per variant `sku`, `hs_code` and `prices: [{ amount, currency_code }]`. Command: grep -rn "hs_code\|origin_country\|categories" apps/backend/node_modules/@medusajs/types/dist/http/product/admin/payloads.d.ts | head>
 */
export const writeApprovalToCoreStep = createStep(
  "write-approval-to-core",
  async (input: WriteApprovalInput, { container }) => {
    const types = await ensureGstProductTypes(container);
    const refs = (await getCatalogService(container).listVendorVariantRefs(
      { product_id: input.product_id },
      { take: null }
    )) as Row[];
    const variantBySku = new Map(refs.map((ref) => [String(ref.vendor_sku), String(ref.variant_id)]));

    const priceByVariant = new Map<string, string>();
    for (const [sku, amount] of Object.entries(input.prices_by_sku)) {
      const variantId = variantBySku.get(sku);
      if (!variantId) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "A priced SKU has no variant.");
      }
      priceByVariant.set(variantId, amount);
    }

    const before = await readCoreView(container, input.product_id);
    const previousPrices = await readInrPrices(container, input.product_id);

    const update = {
      ...(input.handle ? { handle: input.handle } : {}),
      ...(input.publish ? { status: "published" } : {}),
      type_id: types[input.gst_class],
      ...(input.origin_country ? { origin_country: input.origin_country } : {}),
      categories: [{ id: input.category_id }],
      variants: before.variants.map((variant) => ({
        id: variant.id,
        hs_code: input.hsn,
        ...(input.skus[variant.id] ? { sku: input.skus[variant.id] } : {}),
        ...(priceByVariant.has(variant.id)
          ? {
              prices: [
                {
                  amount: Number(priceByVariant.get(variant.id)),
                  currency_code: CURRENCY,
                },
              ],
            }
          : {}),
      })),
    };
    await updateProductsWorkflow(container).run({
      input: { selector: { id: input.product_id }, update: update as never },
    });

    const after = await readCoreView(container, input.product_id);
    const platformById = new Map(after.variants.map((variant) => [variant.id, variant.sku]));
    const platform_skus: Record<string, string> = {};
    for (const [sku, variantId] of variantBySku) {
      const platform = platformById.get(variantId);
      if (platform) {
        platform_skus[sku] = platform;
      }
    }
    const compensation: WriteCompensation = {
      product_id: input.product_id,
      before,
      previous_prices: [...previousPrices],
    };
    return new StepResponse({ platform_skus }, compensation);
  },
  // Restores what the step changed. Prices a variant did not have before are cleared with an
  // empty list; `<RESOLVE: print the variant update input type with `grep -n "prices" apps/backend/node_modules/@medusajs/types/dist/http/product/admin/payloads.d.ts | head`; if an empty prices list is rejected by the core workflow, leave the new price in place and say so in the summary>`.
  async (compensation, { container }) => {
    if (!compensation) {
      return;
    }
    const previous = new Map(compensation.previous_prices);
    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: compensation.product_id },
        update: {
          handle: compensation.before.handle,
          status: compensation.before.status,
          type_id: compensation.before.type_id,
          origin_country: compensation.before.origin_country,
          categories: compensation.before.category_ids.map((id) => ({ id })),
          variants: compensation.before.variants.map((variant) => ({
            id: variant.id,
            sku: variant.sku,
            hs_code: variant.hs_code,
            prices: previous.has(variant.id)
              ? [{ amount: Number(previous.get(variant.id)), currency_code: CURRENCY }]
              : [],
          })),
        } as never,
      },
    });
  }
);

/** Links a new product to the default sales channel. The compensation removes the link. */
export const linkDefaultChannelStep = createStep(
  "link-default-channel",
  async (input: { product_id: string }, { container }) => {
    const channelId = await getDefaultSalesChannelId(container);
    await linkProductsToSalesChannelWorkflow(container).run({
      input: { id: channelId, add: [input.product_id] },
    });
    return new StepResponse({ channel_linked: true }, { product_id: input.product_id, channel_id: channelId });
  },
  async (compensation, { container }) => {
    if (compensation) {
      await linkProductsToSalesChannelWorkflow(container).run({
        input: { id: compensation.channel_id, remove: [compensation.product_id] },
      });
    }
  }
);

export type SetDecisionCoreStatusInput = { product_id: string; status: "draft" | "rejected" };

/** Core status for a decision on a product that is not live yet. */
export const setDecisionCoreStatusStep = createStep(
  "set-decision-core-status",
  async (input: SetDecisionCoreStatusInput, { container }) => {
    const before = await readCoreView(container, input.product_id);
    await updateProductsWorkflow(container).run({
      input: { selector: { id: input.product_id }, update: { status: input.status } as never },
    });
    return new StepResponse(
      { previous: before.status },
      { product_id: input.product_id, previous: before.status }
    );
  },
  async (compensation, { container }) => {
    if (compensation) {
      await updateProductsWorkflow(container).run({
        input: {
          selector: { id: compensation.product_id },
          update: { status: compensation.previous } as never,
        },
      });
    }
  }
);

export type FinalizeDecisionInput = {
  submission_id: string;
  event: DecisionEvent;
  reviewer_user_id: string;
  reason?: string;
  approved_content_hash?: string;
  confirmed?: { category_id: string; gst_class: string; hsn: string };
};

type FinalizeRestore = {
  id: string;
  state: string;
  is_live: boolean;
  pending_changes: unknown;
  content_hash: string;
  approved_content_hash: string | null;
  reviewer_user_id: string | null;
  decided_at: Date | null;
  reason: string | null;
  proposed_category_id: string | null;
  proposed_gst_class: string;
  proposed_hsn: string | null;
};

/**
 * Applies the decision to the submission row: state, live flag, pending revision, reviewer,
 * decision time, reason, the confirmed classification and, when the live content changed, the
 * content hash of what is live now. Runs after every core write of the decision.
 */
export const finalizeDecisionStep = createStep(
  "finalize-catalog-decision",
  async (input: FinalizeDecisionInput, { container }) => {
    const service = getCatalogService(container);
    const [row] = (await service.listProductSubmissions({ id: input.submission_id }, { take: 1 })) as Row[];
    if (!row) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
    }
    const next = transition({ state: row.state, is_live: row.is_live } as never, input.event);

    const update: Row = {
      id: row.id,
      state: next.state,
      is_live: next.is_live,
      reviewer_user_id: input.reviewer_user_id,
      decided_at: new Date(),
      reason: input.reason ?? null,
    };
    if (next.pending === "clear") {
      update.pending_changes = null;
    }
    if (input.approved_content_hash) {
      update.approved_content_hash = input.approved_content_hash;
    }
    if (input.confirmed) {
      update.proposed_category_id = input.confirmed.category_id;
      update.proposed_gst_class = input.confirmed.gst_class;
      update.proposed_hsn = input.confirmed.hsn;
    }
    const restore: FinalizeRestore = {
      id: String(row.id),
      state: String(row.state),
      is_live: Boolean(row.is_live),
      pending_changes: row.pending_changes ?? null,
      content_hash: String(row.content_hash),
      approved_content_hash: (row.approved_content_hash as string | null) ?? null,
      reviewer_user_id: (row.reviewer_user_id as string | null) ?? null,
      decided_at: (row.decided_at as Date | null) ?? null,
      reason: (row.reason as string | null) ?? null,
      proposed_category_id: (row.proposed_category_id as string | null) ?? null,
      proposed_gst_class: String(row.proposed_gst_class),
      proposed_hsn: (row.proposed_hsn as string | null) ?? null,
    };
    await service.updateProductSubmissions(update as never);

    // The live content changed (approval) or the pending revision was dropped (a rejected live
    // edit): the stored hash must describe what is live now, so the next review starts clean.
    if (next.is_live && next.pending === "clear") {
      const live = await loadLiveSnapshotByProduct(container, String(row.product_id));
      await service.updateProductSubmissions({ id: row.id, content_hash: contentHash(live) } as never);
    }

    return new StepResponse(
      {
        submission_id: String(row.id),
        product_id: String(row.product_id),
        vendor_id: String(row.vendor_id),
        revision: Number(row.revision),
        state: String(next.state),
        is_live: Boolean(next.is_live),
        before: { state: String(row.state), is_live: Boolean(row.is_live) },
        after: { state: String(next.state), is_live: Boolean(next.is_live) },
      },
      restore
    );
  },
  async (restore, { container }) => {
    if (restore) {
      await getCatalogService(container).updateProductSubmissions(restore as never);
    }
  }
);

export type ValidateReasonInput = { reason: string };

/** Reason text for a reject or a change request: tags stripped, 10 to 1,000 characters. */
export const validateReasonStep = createStep(
  "validate-decision-reason",
  async (input: ValidateReasonInput) => {
    const reason = stripTags(input.reason).trim();
    if (reason.length < 10) {
      throw decisionError("reason_too_short", "Give a reason of at least 10 characters.");
    }
    if (reason.length > 1000) {
      throw catalogError("validation_failed", "The request has invalid fields.", {
        issues: [{ path: "reason", message: "The reason can have at most 1,000 characters." }],
      });
    }
    return new StepResponse({ reason });
  }
);
