import type { MiddlewareRoute } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";

// Admin routes validate inside their handlers (the staff chain is the only
// middleware entry for `/admin*`), so this slot stays an empty array. It is
// still exported because the catalog aggregate spreads it.
export const reviewsMiddlewares: MiddlewareRoute[] = [];

export const REVIEW_TABS = ["new", "live_edits", "changes_requested", "rejected"] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export const ListReviewsQuery = z.strictObject({
  tab: z.enum(REVIEW_TABS).default("new"),
  limit: z.coerce.number().int().min(1).max(25).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListReviewsQueryInput = z.infer<typeof ListReviewsQuery>;

export const EditReviewContentBody = z
  .strictObject({
    expected_hash: z.string().regex(/^[a-f0-9]{64}$/, "expected_hash is not a content hash"),
    title: z.string().max(1000).optional(),
    description: z.string().max(20000).optional(),
    image_upload_ids: z.array(z.string().min(1).max(64)).min(1).max(10).optional(),
  })
  .refine(
    (body) =>
      body.title !== undefined ||
      body.description !== undefined ||
      body.image_upload_ids !== undefined,
    { message: "Send at least one of title, description or image_upload_ids." }
  );

export type EditReviewContentBodyInput = z.infer<typeof EditReviewContentBody>;
