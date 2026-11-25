import type { MiddlewareRoute } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { MAX_VARIANTS, VENDOR_SKU_PATTERN } from "../content-snapshot";
import { isValidHsn } from "../gst";
import { validateCatalogBody } from "../validate-body";

const contentHashField = z.string().regex(/^[0-9a-f]{64}$/, { message: "Send the content hash shown on the page." });

// The checklist is checked by the workflow, not here: a missing or false item must answer
// `checklist_incomplete`, not the generic validation error. Unknown keys are refused there too.
export const approveBodySchema = z.strictObject({
  content_hash: contentHashField,
  checklist: z.record(z.string(), z.unknown()).optional(),
  gst_class: z.enum(["GST-0", "GST-5", "GST-18", "GST-40"]),
  hsn: z.string().refine(isValidHsn, { message: "An HSN code has 4, 6 or 8 digits." }),
  category_id: z.string().min(1).max(64),
  prices: z
    .array(
      z.strictObject({
        vendor_sku: z.string().regex(VENDOR_SKU_PATTERN),
        selling_price: z.string().max(20),
      })
    )
    .max(MAX_VARIANTS),
});

export const reasonBodySchema = z.strictObject({
  content_hash: contentHashField,
  reason: z.string().max(1000),
});

export type ApproveBody = z.infer<typeof approveBodySchema>;
export type ReasonBody = z.infer<typeof reasonBodySchema>;

// Mounted from reviews.ts, after the admin chain (authentication, two-factor gate, permission).
export const reviewDecisionEntries: MiddlewareRoute[] = [
  {
    method: ["POST"],
    matcher: "/admin/product-reviews/:id/approve",
    middlewares: [validateCatalogBody(approveBodySchema)],
  },
  {
    method: ["POST"],
    matcher: "/admin/product-reviews/:id/reject",
    middlewares: [validateCatalogBody(reasonBodySchema)],
  },
  {
    method: ["POST"],
    matcher: "/admin/product-reviews/:id/request-changes",
    middlewares: [validateCatalogBody(reasonBodySchema)],
  },
];
