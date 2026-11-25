import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import multer from "multer";
import {
  IMPORT_MAX_BYTES,
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

// Exactly one file in the field named "file", at most 1 MiB (1048576 bytes), no other field.
// The file stays in memory: it is read twice, by the scanner and by the importer, and dropped.
const parseOneFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_MAX_BYTES, files: 1, fields: 0, parts: 2 },
}).single("file");

const UNEXPECTED_FIELD_CODES = new Set([
  "LIMIT_UNEXPECTED_FILE",
  "LIMIT_FILE_COUNT",
  "LIMIT_FIELD_COUNT",
  "LIMIT_FIELD_KEY",
  "LIMIT_FIELD_VALUE",
  "LIMIT_PART_COUNT",
]);

const refuse = (res: MedusaResponse, code: string, message: string): void => {
  res.status(400).json({ type: "invalid_data", code, message });
};

/**
 * Reads the multipart body. It runs after the vendor request chain, so a request that is not
 * signed in never reaches it and its body is never read. As a second line of defence it refuses
 * to read anything when no vendor was attached to the request.
 */
export function parseImportBody(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  if (!(req as { vendor?: unknown }).vendor) {
    res.status(401).json({ type: "unauthorized", message: "Unauthorized" });
    return;
  }
  if (!/^multipart\/form-data/i.test(String(req.headers["content-type"] ?? ""))) {
    refuse(res, "file_required", "Send the file as multipart form data in the field named file.");
    return;
  }
  parseOneFile(req as never, res as never, (error?: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        refuse(res, "file_too_large", "The file is larger than 1 MB.");
        return;
      }
      if (UNEXPECTED_FIELD_CODES.has(error.code)) {
        refuse(res, "unexpected_field", "Send exactly one file in the field named file and nothing else.");
        return;
      }
    }
    next(error);
  });
}

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
  {
    method: ["POST"],
    matcher: "/vendor/inventory/import",
    // The framework must not read this stream before the wrapper does.
    bodyParser: false,
    middlewares: [parseImportBody],
  },
];
