import { z } from "@medusajs/framework/zod";

export const AcceptInviteSchema = z.strictObject({
  token: z.string().min(20).max(200),
  password: z.string().min(12).max(128),
});
export type AcceptInviteBody = z.infer<typeof AcceptInviteSchema>;

export const AcceptAgreementSchema = z.strictObject({
  version: z.string().min(1).max(32),
  accepted: z.literal(true),
});
export type AcceptAgreementBody = z.infer<typeof AcceptAgreementSchema>;

// No vendor read route takes a query yet. A route that does adds its schema to
// VENDOR_QUERY_SCHEMAS in lib/vendor/middlewares.ts, keyed by method and path.
export const EmptyQuerySchema = z.strictObject({});
export type EmptyQuery = z.infer<typeof EmptyQuerySchema>;
