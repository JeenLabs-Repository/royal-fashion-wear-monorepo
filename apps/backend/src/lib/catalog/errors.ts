import type { MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";

export const CATALOG_ERROR_STATUS = {
  validation_failed: 400,
  duplicate_vendor_sku: 409,
  unknown_upload: 404,
  upload_already_used: 409,
  unknown_category: 400,
  unknown_variant: 400,
  vendor_not_eligible: 403,
  locked_in_review: 409,
  rejected_final: 409,
  invalid_transition: 409,
  no_changes: 400,
  variant_has_stock_or_orders: 409,
  incomplete_content: 400,
} as const;

export type CatalogErrorCode = keyof typeof CATALOG_ERROR_STATUS;

type Extra = Record<string, unknown>;

const typeFor = (status: number): string => {
  if (status === 404) {
    return MedusaError.Types.NOT_FOUND;
  }
  if (status === 409) {
    return MedusaError.Types.CONFLICT;
  }
  if (status === 403) {
    return MedusaError.Types.NOT_ALLOWED;
  }
  return MedusaError.Types.INVALID_DATA;
};

export class CatalogError extends MedusaError {
  readonly extra: Extra;

  constructor(code: CatalogErrorCode, message: string, extra: Extra = {}) {
    super(typeFor(CATALOG_ERROR_STATUS[code]), message, code);
    this.extra = extra;
  }
}

export const catalogError = (code: CatalogErrorCode, message: string, extra: Extra = {}) =>
  new CatalogError(code, message, extra);

const isCatalogCode = (value: unknown): value is CatalogErrorCode =>
  typeof value === "string" && value in CATALOG_ERROR_STATUS;

/**
 * Answers a catalog error with its status and the shape `{ type, code, message }` plus
 * its extra keys (`issues`, `skus`). Returns false for any other error so the caller
 * rethrows it to the framework handler.
 */
export function respondWithCatalogError(res: MedusaResponse, error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown; extra?: unknown } | null;
  if (!candidate || !isCatalogCode(candidate.code)) {
    return false;
  }
  const code = candidate.code;
  const status = CATALOG_ERROR_STATUS[code];
  res.status(status).json({
    type: typeFor(status),
    code,
    message: String(candidate.message ?? ""),
    ...((candidate.extra as Extra | undefined) ?? {}),
  });
  return true;
}

type Handler<Req> = (req: Req, res: MedusaResponse) => Promise<void>;

/** Wraps a route handler so catalog errors answer with their own status. */
export const withCatalogErrors =
  <Req>(handler: Handler<Req>): Handler<Req> =>
  async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!respondWithCatalogError(res, error)) {
        throw error;
      }
    }
  };
