import type { MiddlewareRoute } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import {
  MAX_ENTRIES_PER_REQUEST,
  MAX_STOCK_QUANTITY,
  STOCK_PAGE_SIZE,
} from "../../stock/constants";
import { VENDOR_QUERY_SCHEMAS } from "../../vendor/middlewares";
import { strictQuery } from "../../vendor/strict-query";
import { validateCatalogBody } from "../validate-body";

export const putStockBodySchema = z.strictObject({
  updates: z
    .array(
      z.strictObject({
        variant_id: z.string().min(1).max(64),
        location_code: z.string().min(1).max(32),
        stocked_quantity: z.number().int().min(0).max(MAX_STOCK_QUANTITY),
      })
    )
    .min(1)
    .max(MAX_ENTRIES_PER_REQUEST),
});

export type PutStockBody = z.infer<typeof putStockBodySchema>;

// Unknown query keys are a 400, so a foreign vendor id in the query never reaches the handler.
export const stockQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(STOCK_PAGE_SIZE).default(STOCK_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().max(80).optional(),
});

export type StockQuery = z.infer<typeof stockQuerySchema>;

// The vendor chain deny-by-default query check runs before catalog middlewares.
VENDOR_QUERY_SCHEMAS["GET /vendor/inventory"] = stockQuerySchema;

// The spread order in src/api/middlewares.ts puts these after the vendor chain, so
// authentication, the two-factor gate and the status guard have already run.
export const inventoryMiddlewares: MiddlewareRoute[] = [
  {
    method: ["GET"],
    matcher: "/vendor/inventory",
    middlewares: [strictQuery(stockQuerySchema)],
  },
  {
    method: ["PUT"],
    matcher: "/vendor/inventory",
    middlewares: [validateCatalogBody(putStockBodySchema)],
  },
];
