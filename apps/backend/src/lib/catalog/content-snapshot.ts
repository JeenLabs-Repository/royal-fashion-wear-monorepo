import { createHash } from "node:crypto";
import { z } from "@medusajs/framework/zod";
import { GST_CLASSES, isValidHsn } from "./gst";
import { isRupees, parseRupees } from "./money";
import { stripTags } from "./text";

export const MAX_TITLE_LENGTH = 150;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_IMAGES = 10;
export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 50;
export const VENDOR_SKU_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
export const NET_QUANTITY_UNITS = ["g", "kg", "ml", "l", "pcs"] as const;

// Plain text: tags are stripped first, then the length limits apply to what is left.
const plainText = (label: string, max: number) =>
  z
    .string()
    .transform(stripTags)
    .pipe(
      z
        .string()
        .min(1, { message: `${label} is required.` })
        .max(max, { message: `${label} must be at most ${max} characters.` })
    );

const rupees = z
  .string()
  .refine(isRupees, {
    message: "Enter an amount from 0.01 to 999,999.99 with at most two decimals.",
  })
  .transform(parseRupees);

const dimension = (max: number) => z.number().int().min(1).max(max);

const optionSchema = z.strictObject({
  title: plainText("Option name", 60),
  values: z.array(plainText("Option value", 60)).min(1).max(30),
});

const variantSchema = z.strictObject({
  // Present only when editing a variant that already exists.
  variant_id: z.string().min(1).max(64).optional(),
  vendor_sku: z.string().regex(VENDOR_SKU_PATTERN, {
    message: "Use 1 to 40 letters, digits, dashes or underscores.",
  }),
  option_values: z.record(z.string(), z.string()),
  payout_price: rupees,
  mrp: rupees.optional(),
  net_quantity_value: z.number().positive().max(1_000_000).optional(),
  net_quantity_unit: z.enum(NET_QUANTITY_UNITS).optional(),
  weight_g: dimension(1_000_000).optional(),
  length_mm: dimension(100_000).optional(),
  width_mm: dimension(100_000).optional(),
  height_mm: dimension(100_000).optional(),
});

const declarationSchema = z.strictObject({
  generic_name: plainText("Generic name", 150),
  country_of_origin: z.string().regex(/^[A-Z]{2}$/, {
    message: "Use a two-letter uppercase country code.",
  }),
  packed_by_name: plainText("Packed by name", 150),
  packed_by_address: plainText("Packed by address", 500),
});

export const vendorContentSchema = z
  .strictObject({
    title: plainText("Title", MAX_TITLE_LENGTH),
    description: plainText("Description", MAX_DESCRIPTION_LENGTH),
    // Images are references to uploads the vendor made, never URLs.
    images: z
      .array(z.strictObject({ upload_id: z.string().min(1).max(64) }))
      .min(1)
      .max(MAX_IMAGES),
    options: z.array(optionSchema).max(MAX_OPTIONS),
    variants: z.array(variantSchema).min(1).max(MAX_VARIANTS),
    proposed_category_id: z.string().min(1).max(64),
    proposed_gst_class: z.enum(GST_CLASSES),
    proposed_hsn: z
      .string()
      .refine(isValidHsn, { message: "An HSN code has 4, 6 or 8 digits." })
      .optional(),
    declaration: declarationSchema,
  })
  .superRefine((content, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", message, path });

    const titles = new Set<string>();
    content.options.forEach((option, index) => {
      if (titles.has(option.title)) {
        issue(["options", index, "title"], "Option names must be different.");
      }
      titles.add(option.title);
      if (new Set(option.values).size !== option.values.length) {
        issue(["options", index, "values"], "Option values must be different.");
      }
    });

    const seenUploads = new Set<string>();
    content.images.forEach((image, index) => {
      if (seenUploads.has(image.upload_id)) {
        issue(["images", index, "upload_id"], "Each image can be used once.");
      }
      seenUploads.add(image.upload_id);
    });

    if (content.options.length === 0 && content.variants.length > 1) {
      issue(["variants"], "Add an option before adding more than one variant.");
    }

    const seenSkus = new Set<string>();
    const seenCombinations = new Set<string>();
    content.variants.forEach((variant, index) => {
      if (seenSkus.has(variant.vendor_sku)) {
        issue(["variants", index, "vendor_sku"], "Each variant needs its own SKU.");
      }
      seenSkus.add(variant.vendor_sku);

      for (const option of content.options) {
        const value = variant.option_values[option.title];
        if (value === undefined) {
          issue(
            ["variants", index, "option_values", option.title],
            `Choose a value for ${option.title}.`
          );
        } else if (!option.values.includes(value)) {
          issue(
            ["variants", index, "option_values", option.title],
            `${value} is not a listed value of ${option.title}.`
          );
        }
      }
      for (const key of Object.keys(variant.option_values)) {
        if (!titles.has(key)) {
          issue(["variants", index, "option_values", key], `${key} is not an option.`);
        }
      }

      const combination = JSON.stringify(
        content.options.map((option) => variant.option_values[option.title] ?? null)
      );
      if (seenCombinations.has(combination)) {
        issue(["variants", index, "option_values"], "Two variants have the same option values.");
      }
      seenCombinations.add(combination);
    });
  });

export type ContentSnapshot = z.output<typeof vendorContentSchema>;

// Sorts object keys recursively. Arrays keep their order, except `variants`,
// which is sorted by vendor SKU so the order a vendor lists them in does not
// change the hash. Undefined values are dropped, like JSON does.
const canonicalize = (value: unknown, key?: string): unknown => {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    if (key === "variants") {
      return items.sort((a, b) =>
        String((a as { vendor_sku?: string }).vendor_sku).localeCompare(
          String((b as { vendor_sku?: string }).vendor_sku)
        )
      );
    }
    return items;
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .filter((name) => source[name] !== undefined)
        .sort()
        .map((name) => [name, canonicalize(source[name], name)])
    );
  }
  return value;
};

/** Stable JSON text of the reviewable content. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Hash of the reviewable content. Approval is of this hash, so a later edit
 * makes an approval of the older content stale. Nothing from the submission
 * itself (ids, times, revision number) belongs in the input.
 */
export function contentHash(snapshot: ContentSnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}
