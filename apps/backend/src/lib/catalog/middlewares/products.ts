import type { MiddlewareRoute } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { VENDOR_QUERY_SCHEMAS } from "../../vendor/middlewares";
import { strictQuery } from "../../vendor/strict-query";
import { vendorContentSchema } from "../content-snapshot";
import { validateCatalogBody } from "../validate-body";

export const VENDOR_PRODUCT_STATES = [
  "draft",
  "submitted",
  "approved",
  "changes_requested",
  "rejected",
  "withdrawn",
] as const;

// Unknown query keys are a 400, so a foreign vendor id in the query never reaches the handler.
export const vendorProductsQuerySchema = z.strictObject({
  state: z.enum(VENDOR_PRODUCT_STATES).optional(),
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type VendorProductsQuery = z.infer<typeof vendorProductsQuerySchema>;

// The vendor chain deny-by-default query check runs before catalog middlewares.
// Register the list query here so limit, offset, state and q are not refused as
// unrecognized keys.
VENDOR_QUERY_SCHEMAS["GET /vendor/products"] = vendorProductsQuerySchema;

// Submit, withdraw and discard take no body: any key is a 400.
const emptyBody = validateCatalogBody(z.strictObject({}));

// The spread order in src/api/middlewares.ts puts these after the vendor chain, so
// authentication, the two-factor gate and the status guard have already run.
export const productsMiddlewares: MiddlewareRoute[] = [
  {
    method: ["POST"],
    matcher: "/vendor/products",
    middlewares: [validateCatalogBody(vendorContentSchema)],
  },
  {
    method: ["GET"],
    matcher: "/vendor/products",
    middlewares: [strictQuery(vendorProductsQuerySchema)],
  },
  {
    method: ["POST"],
    matcher: "/vendor/products/:id",
    middlewares: [validateCatalogBody(vendorContentSchema)],
  },
  {
    method: ["POST"],
    matcher: "/vendor/products/:id/discard-changes",
    middlewares: [emptyBody],
  },
  {
    method: ["POST"],
    matcher: "/vendor/products/:id/submit",
    middlewares: [emptyBody],
  },
  {
    method: ["POST"],
    matcher: "/vendor/products/:id/withdraw",
    middlewares: [emptyBody],
  },
];
