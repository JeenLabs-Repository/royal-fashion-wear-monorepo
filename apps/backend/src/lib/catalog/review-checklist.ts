import { z } from "@medusajs/framework/zod";

// The anonymity checklist an approver confirms before a product goes on sale.
// The order is the order the screen shows.
export const CHECKLIST_KEYS = [
  "no_identifying_text",
  "no_watermark_or_logo",
  "images_checked",
  "declarations_reviewed",
  "gst_and_hsn_set",
  "selling_price_set",
] as const;

export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  no_identifying_text:
    "No vendor name, brand that is the vendor, phone, email or URL in title, description or images",
  no_watermark_or_logo: "No watermark or logo in any image",
  images_checked: "Every image was checked visually",
  declarations_reviewed: "Declarations were reviewed against the written legal answer",
  gst_and_hsn_set: "GST class and HSN are set",
  selling_price_set: "Selling price is set for every variant",
};

export const CHECKLIST_ITEMS: ReadonlyArray<{ key: ChecklistKey; label: string }> =
  CHECKLIST_KEYS.map((key) => ({ key, label: CHECKLIST_LABELS[key] }));

// Every item must be the literal `true`; a missing, false or extra key fails.
export const checklistSchema = z.strictObject({
  no_identifying_text: z.literal(true),
  no_watermark_or_logo: z.literal(true),
  images_checked: z.literal(true),
  declarations_reviewed: z.literal(true),
  gst_and_hsn_set: z.literal(true),
  selling_price_set: z.literal(true),
});

export type ChecklistAnswers = z.infer<typeof checklistSchema>;
