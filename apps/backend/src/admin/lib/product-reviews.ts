import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sdk } from "./client";
import { fetchMe, isForbidden, staffKeys } from "./staff-api";

export const REVIEW_TABS = [
  { key: "new", label: "New" },
  { key: "live_edits", label: "Live edits" },
  { key: "changes_requested", label: "Changes requested" },
  { key: "rejected", label: "Rejected" },
] as const;

export type ReviewTab = (typeof REVIEW_TABS)[number]["key"];

export const PAGE_SIZE = 25;
export const GST_CLASSES = ["GST-0", "GST-5", "GST-18", "GST-40"] as const;

type Scalar = string | number | boolean | null;

export type ReviewVariant = {
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

export type ReviewContent = {
  title: string;
  description: string;
  images: { upload_id: string; url: string | null }[];
  options: { title: string; values: { value: string }[] }[];
  variants: ReviewVariant[];
  proposed_category_id: string | null;
  proposed_category_name: string | null;
  proposed_gst_class: string | null;
  proposed_hsn: string | null;
  declaration: {
    generic_name: string | null;
    country_of_origin: string | null;
    packed_by_name: string | null;
    packed_by_address: string | null;
  };
};

export type ReviewDiffEntry = {
  path: string;
  before: Scalar;
  after: Scalar;
  before_items: { value: string }[];
  after_items: { value: string }[];
};

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
  submitted_at: string | null;
  decided_at: string | null;
  display_mode: string;
  content: ReviewContent;
  live_content: ReviewContent | null;
  diff: ReviewDiffEntry[];
  live_prices: { vendor_sku: string; selling_price: string }[];
  approver_edits: { field: string; before: string; after: string }[];
  checklist: { key: string; label: string }[];
};

export type ReviewListItem = {
  id: string;
  product_id: string;
  title: string;
  state: string;
  is_live: boolean;
  has_pending: boolean;
  revision: number;
  submitted_at: string | null;
  decided_at: string | null;
  reason: string | null;
};

export type ReviewListResponse = {
  reviews: ReviewListItem[];
  count: number;
  limit: number;
  offset: number;
};

export type ApproveInput = {
  content_hash: string;
  checklist: Record<string, true>;
  gst_class: string;
  hsn: string;
  category_id: string;
  prices: { vendor_sku: string; selling_price: string }[];
};

export type ReasonInput = { content_hash: string; reason: string };

export type EditContentInput = {
  expected_hash: string;
  title?: string;
  description?: string;
  image_upload_ids?: string[];
};

export type CategoryOption = { id: string; name: string };

export const reviewKeys = {
  all: ["product-reviews"] as const,
  list: (tab: ReviewTab, offset: number) => ["product-reviews", "list", tab, offset] as const,
  detail: (id: string) => ["product-reviews", "detail", id] as const,
  categories: ["product-reviews", "categories"] as const,
};

const BASE = "/admin/product-reviews";
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export type ReviewFailure = { forbidden: boolean; stale: boolean; message: string };

const statusOf = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;

/** Maps an SDK error to the two flags the screens act on and a plain message. */
export const describeError = (error: unknown): ReviewFailure => ({
  forbidden: isForbidden(error),
  stale: statusOf(error) === 409,
  message: error instanceof Error && error.message ? error.message : "Something went wrong.",
});

export const useReviews = (tab: ReviewTab, offset: number) =>
  useQuery({
    queryKey: reviewKeys.list(tab, offset),
    queryFn: () =>
      sdk.client.fetch<ReviewListResponse>(BASE, {
        query: { tab, limit: PAGE_SIZE, offset },
      }),
  });

export const useReview = (id: string) =>
  useQuery({
    queryKey: reviewKeys.detail(id),
    queryFn: () => sdk.client.fetch<{ review: ReviewDetail }>(one(id)),
  });

export const useApprove = (id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ApproveInput) =>
      sdk.client.fetch(`${one(id)}/approve`, { method: "POST", body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: reviewKeys.all }),
  });
};

export const useReject = (id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ReasonInput) =>
      sdk.client.fetch(`${one(id)}/reject`, { method: "POST", body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: reviewKeys.all }),
  });
};

export const useRequestChanges = (id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ReasonInput) =>
      sdk.client.fetch(`${one(id)}/request-changes`, { method: "POST", body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: reviewKeys.all }),
  });
};

export const useEditContent = (id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EditContentInput) =>
      sdk.client.fetch<{ review: ReviewDetail }>(`${one(id)}/content`, {
        method: "POST",
        body: input,
      }),
    onSuccess: (data) => {
      client.setQueryData(reviewKeys.detail(id), data);
      return client.invalidateQueries({ queryKey: [...reviewKeys.all, "list"] });
    },
  });
};

export const useCategories = () =>
  useQuery({
    queryKey: reviewKeys.categories,
    queryFn: async () => {
      const result = await sdk.client.fetch<{ product_categories: CategoryOption[] }>(
        "/admin/product-categories",
        { query: { limit: 200, fields: "id,name" } }
      );
      return result.product_categories;
    },
  });

/** Permissions only switch buttons on and off; the API is the security boundary. */
export const useMyPermissions = () => {
  const query = useQuery({ queryKey: staffKeys.me, queryFn: fetchMe });
  const permissions = query.data?.permissions ?? [];
  return {
    isLoading: query.isLoading,
    can: (permission: string) => permissions.includes(permission),
  };
};

// Selling price rules, the same as the server: rupees, at most two decimals,
// at least 0.01 and at most 999,999.99, and never above the MRP.
const RUPEES = /^(0|[1-9]\d{0,5})(\.\d{1,2})?$/;

export const toPaise = (value: string): number | null => {
  const text = value.trim();
  if (!RUPEES.test(text)) {
    return null;
  }
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};

export const priceProblem = (value: string, mrp: Scalar): string | null => {
  if (value.trim() === "") {
    return "Enter a selling price.";
  }
  const paise = toPaise(value);
  if (paise === null) {
    return "Use rupees with at most two decimals.";
  }
  if (paise < 1) {
    return "The price must be at least 0.01.";
  }
  if (mrp !== null && mrp !== "") {
    const limit = toPaise(String(mrp));
    if (limit !== null && paise > limit) {
      return `The price cannot be higher than the MRP of ${mrp}.`;
    }
  }
  return null;
};

export const isValidHsn = (value: string): boolean => /^(\d{4}|\d{6}|\d{8})$/.test(value.trim());

export const ageInDays = (iso: string | null, now: number = Date.now()): number | null => {
  if (!iso) {
    return null;
  }
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now - time) / 86_400_000));
};

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const relativeTime = (iso: string | null, now: number = Date.now()): string => {
  if (!iso) {
    return "Not submitted";
  }
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) {
      return RELATIVE.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
};

export const exactTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("en-IN") : "";

export const STATE_LABELS: Record<string, string> = {
  submitted: "In review",
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  draft: "Draft",
};
