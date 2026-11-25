import {
  defineAllowlistSerializer,
  type Shape,
} from "../serializers/define-allowlist-serializer";
import { CHECKLIST_ITEMS } from "./review-checklist";
import type { DiffEntry, DiffValue, DiffableSnapshot } from "./diff";

// Staff-facing views of the review queue. These are admin responses: they may
// show payout prices and the vendor SKU that approval keys on, and they never
// carry the vendor id, the vendor name, a handle, a sales channel or core
// metadata. The allowlist shapes below are the only way a key reaches a
// response. The shape helper copies a scalar for `true` and drops arrays of
// scalars, so lists are modelled as arrays of small objects.

type Scalar = string | number | boolean | null;

type ReviewVariantView = {
  vendor_sku: string;
  option_values: { option: string; value: string }[];
  payout_price: Scalar;
  mrp: Scalar;
  net_quantity_value: Scalar;
  net_quantity_unit: Scalar;
  weight_g: Scalar;
  length_mm: Scalar;
  width_mm: Scalar;
  height_mm: Scalar;
};

export type ReviewContentView = {
  title: string;
  description: string;
  images: { upload_id: string; url: string | null }[];
  options: { title: string; values: { value: string }[] }[];
  variants: ReviewVariantView[];
  proposed_category_id: Scalar;
  proposed_category_name: Scalar;
  proposed_gst_class: Scalar;
  proposed_hsn: Scalar;
  declaration: {
    generic_name: Scalar;
    country_of_origin: Scalar;
    packed_by_name: Scalar;
    packed_by_address: Scalar;
  };
};

export type DiffViewEntry = {
  path: string;
  before: Scalar;
  after: Scalar;
  before_items: { value: string }[];
  after_items: { value: string }[];
};

export type ApproverEdit = { field: string; before: string; after: string };

export type ReviewDetail = {
  id: string;
  product_id: string;
  state: string;
  tab: string | null;
  is_live: boolean;
  has_pending: boolean;
  revision: number;
  content_hash: string;
  reason: string | null;
  submitted_at: Date | string | null;
  decided_at: Date | string | null;
  display_mode: string;
  content: ReviewContentView;
  live_content: ReviewContentView | null;
  diff: DiffViewEntry[];
  live_prices: { vendor_sku: string; selling_price: string }[];
  approver_edits: ApproverEdit[];
};

export type ReviewListItem = {
  id: string;
  product_id: string;
  title: string;
  state: string;
  is_live: boolean;
  has_pending: boolean;
  revision: number;
  submitted_at: Date | string | null;
  decided_at: Date | string | null;
  reason: string | null;
};

const orNull = <T>(value: T | null | undefined): T | null => (value === undefined ? null : value);

/** Turns a snapshot into the plain view the serializer allowlists. */
export function toReviewContentView(
  snapshot: DiffableSnapshot,
  urlByUploadId: Map<string, string>,
  categoryName: string | null
): ReviewContentView {
  return {
    title: snapshot.title,
    description: snapshot.description,
    images: snapshot.images.map((image) => ({
      upload_id: image.upload_id,
      url: urlByUploadId.get(image.upload_id) ?? null,
    })),
    options: (snapshot.options ?? []).map((option) => ({
      title: option.title,
      values: option.values.map((value) => ({ value })),
    })),
    variants: snapshot.variants.map((variant) => ({
      vendor_sku: variant.vendor_sku,
      option_values: Object.entries(variant.option_values ?? {}).map(([option, value]) => ({
        option,
        value,
      })),
      payout_price: orNull(variant.payout_price),
      mrp: orNull(variant.mrp),
      net_quantity_value: orNull(variant.net_quantity_value),
      net_quantity_unit: orNull(variant.net_quantity_unit),
      weight_g: orNull(variant.weight_g),
      length_mm: orNull(variant.length_mm),
      width_mm: orNull(variant.width_mm),
      height_mm: orNull(variant.height_mm),
    })),
    proposed_category_id: orNull(snapshot.proposed_category_id),
    proposed_category_name: categoryName,
    proposed_gst_class: orNull(snapshot.proposed_gst_class),
    proposed_hsn: orNull(snapshot.proposed_hsn),
    declaration: {
      generic_name: orNull(snapshot.declaration?.generic_name),
      country_of_origin: orNull(snapshot.declaration?.country_of_origin),
      packed_by_name: orNull(snapshot.declaration?.packed_by_name),
      packed_by_address: orNull(snapshot.declaration?.packed_by_address),
    },
  };
}

const splitValue = (value: DiffValue): { scalar: Scalar; items: { value: string }[] } =>
  Array.isArray(value)
    ? { scalar: null, items: value.map((item) => ({ value: item })) }
    : { scalar: value, items: [] };

/** A list value becomes `before_items` or `after_items`; a scalar stays in `before` or `after`. */
export function toDiffView(entries: DiffEntry[]): DiffViewEntry[] {
  return entries.map((entry) => {
    const before = splitValue(entry.before);
    const after = splitValue(entry.after);
    return {
      path: entry.path,
      before: before.scalar,
      after: after.scalar,
      before_items: before.items,
      after_items: after.items,
    };
  });
}

const contentShape: Shape = {
  title: true,
  description: true,
  images: { upload_id: true, url: true },
  options: { title: true, values: { value: true } },
  variants: {
    vendor_sku: true,
    option_values: { option: true, value: true },
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
  proposed_category_name: true,
  proposed_gst_class: true,
  proposed_hsn: true,
  declaration: {
    generic_name: true,
    country_of_origin: true,
    packed_by_name: true,
    packed_by_address: true,
  },
};

export const reviewListItemSerializer = defineAllowlistSerializer<ReviewListItem>({
  name: "admin-product-review-list-item",
  audience: "admin",
  shape: {
    id: true,
    product_id: true,
    title: true,
    state: true,
    is_live: true,
    has_pending: true,
    revision: true,
    submitted_at: true,
    decided_at: true,
    reason: true,
  },
});

export const reviewDetailSerializer = defineAllowlistSerializer({
  name: "admin-product-review-detail",
  audience: "admin",
  shape: {
    id: true,
    product_id: true,
    state: true,
    tab: true,
    is_live: true,
    has_pending: true,
    revision: true,
    content_hash: true,
    reason: true,
    submitted_at: true,
    decided_at: true,
    display_mode: true,
    content: contentShape,
    live_content: contentShape,
    diff: {
      path: true,
      before: true,
      after: true,
      before_items: { value: true },
      after_items: { value: true },
    },
    live_prices: { vendor_sku: true, selling_price: true },
    approver_edits: { field: true, before: true, after: true },
    checklist: { key: true, label: true },
  },
});

export function serializeReviewList(items: ReviewListItem[]) {
  return reviewListItemSerializer.serializeMany(items);
}

export function serializeReviewDetail(detail: ReviewDetail) {
  return {
    review: reviewDetailSerializer.serialize({
      ...detail,
      checklist: CHECKLIST_ITEMS.map((item) => ({ key: item.key, label: item.label })),
    }),
  };
}
