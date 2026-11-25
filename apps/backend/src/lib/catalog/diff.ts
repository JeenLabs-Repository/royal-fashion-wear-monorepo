// Field-level difference between the live content of a product and a pending
// revision. Pure: no framework imports, so the unit spec needs no container.

export type DiffValue = string | number | boolean | null | string[];

export type DiffEntry = { path: string; before: DiffValue; after: DiffValue };

type Scalar = string | number | null | undefined;

type VariantLike = {
  vendor_sku: string;
  option_values?: Record<string, string> | null;
  payout_price?: Scalar;
  mrp?: Scalar;
  net_quantity_value?: Scalar;
  net_quantity_unit?: Scalar;
  weight_g?: Scalar;
  length_mm?: Scalar;
  width_mm?: Scalar;
  height_mm?: Scalar;
};

/** The parts of a content snapshot the diff reads. */
export type DiffableSnapshot = {
  title: string;
  description: string;
  images: { upload_id: string }[];
  options?: { title: string; values: string[] }[] | null;
  variants: VariantLike[];
  proposed_category_id?: Scalar;
  proposed_gst_class?: Scalar;
  proposed_hsn?: Scalar;
  declaration?: {
    generic_name?: Scalar;
    country_of_origin?: Scalar;
    packed_by_name?: Scalar;
    packed_by_address?: Scalar;
  } | null;
};

const DECLARATION_FIELDS = [
  "generic_name",
  "country_of_origin",
  "packed_by_name",
  "packed_by_address",
] as const;

const VARIANT_FIELDS = [
  "payout_price",
  "mrp",
  "net_quantity_value",
  "net_quantity_unit",
  "weight_g",
  "length_mm",
  "width_mm",
  "height_mm",
] as const;

const orNull = <T>(value: T | null | undefined): T | null => (value === undefined ? null : value);

const same = (a: DiffValue, b: DiffValue): boolean => JSON.stringify(a) === JSON.stringify(b);

const optionLines = (snapshot: DiffableSnapshot): string[] =>
  (snapshot.options ?? []).map((option) => `${option.title}: ${option.values.join(", ")}`);

/**
 * Entries in a fixed order: title, description, images, options, category, GST
 * class, HSN, declaration fields, then variants sorted by vendor SKU. A
 * reorder of the images is a change. Variants are matched by vendor SKU, never
 * by position.
 */
export function diffSnapshots(live: DiffableSnapshot, pending: DiffableSnapshot): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const push = (path: string, before: DiffValue, after: DiffValue): void => {
    if (!same(before, after)) {
      entries.push({ path, before, after });
    }
  };

  push("title", live.title, pending.title);
  push("description", live.description, pending.description);
  push(
    "images",
    live.images.map((image) => image.upload_id),
    pending.images.map((image) => image.upload_id)
  );
  push("options", optionLines(live), optionLines(pending));
  push("proposed_category_id", orNull(live.proposed_category_id), orNull(pending.proposed_category_id));
  push("proposed_gst_class", orNull(live.proposed_gst_class), orNull(pending.proposed_gst_class));
  push("proposed_hsn", orNull(live.proposed_hsn), orNull(pending.proposed_hsn));

  for (const field of DECLARATION_FIELDS) {
    push(
      `declaration.${field}`,
      orNull(live.declaration?.[field]),
      orNull(pending.declaration?.[field])
    );
  }

  const liveBySku = new Map(live.variants.map((variant) => [variant.vendor_sku, variant]));
  const pendingBySku = new Map(pending.variants.map((variant) => [variant.vendor_sku, variant]));
  const skus = [...new Set([...liveBySku.keys(), ...pendingBySku.keys()])].sort();

  for (const sku of skus) {
    const before = liveBySku.get(sku);
    const after = pendingBySku.get(sku);
    const base = `variants[${sku}]`;

    if (!before && after) {
      entries.push({ path: base, before: "absent", after: "added" });
      continue;
    }
    if (before && !after) {
      entries.push({ path: base, before: "present", after: "removed" });
      continue;
    }
    if (!before || !after) {
      continue;
    }

    for (const field of VARIANT_FIELDS) {
      push(`${base}.${field}`, orNull(before[field]), orNull(after[field]));
    }

    const beforeOptions = before.option_values ?? {};
    const afterOptions = after.option_values ?? {};
    const optionKeys = [...new Set([...Object.keys(beforeOptions), ...Object.keys(afterOptions)])].sort();
    for (const key of optionKeys) {
      push(
        `${base}.option_values.${key}`,
        orNull(beforeOptions[key]),
        orNull(afterOptions[key])
      );
    }
  }

  return entries;
}
