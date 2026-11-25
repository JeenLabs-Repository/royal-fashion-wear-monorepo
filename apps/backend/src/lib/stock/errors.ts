import type { MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { respondWithCatalogError } from "../catalog/errors";

export const STOCK_ERROR_STATUS = {
  stock_rejected: 400,
  not_found: 404,
  invalid_header: 400,
  too_many_rows: 400,
  file_too_large: 400,
  invalid_utf8: 400,
  invalid_csv: 400,
  file_required: 400,
} as const;

export type StockErrorCode = keyof typeof STOCK_ERROR_STATUS;

type Extra = Record<string, unknown>;

const typeFor = (status: number): string =>
  status === 404 ? MedusaError.Types.NOT_FOUND : MedusaError.Types.INVALID_DATA;

export class StockError extends MedusaError {
  readonly extra: Extra;

  constructor(code: StockErrorCode, message: string, extra: Extra = {}) {
    super(typeFor(STOCK_ERROR_STATUS[code]), message, code);
    this.extra = extra;
  }
}

export const stockError = (code: StockErrorCode, message: string, extra: Extra = {}) =>
  new StockError(code, message, extra);

/** The one answer for a variant or location that is unknown or belongs to another vendor. */
export const notFoundError = () => stockError("not_found", "Not found");

export function respondWithStockError(res: MedusaResponse, error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown; extra?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : undefined;
  if (code && code in STOCK_ERROR_STATUS) {
    const status = STOCK_ERROR_STATUS[code as StockErrorCode];
    res.status(status).json({
      type: typeFor(status),
      code,
      message: String(candidate?.message ?? ""),
      ...((candidate?.extra as Extra | undefined) ?? {}),
    });
    return true;
  }
  return respondWithCatalogError(res, error);
}

type Handler<Req> = (req: Req, res: MedusaResponse) => Promise<void>;

/** Wraps a stock route so stock and catalog errors answer with their own status. */
export const withStockErrors =
  <Req>(handler: Handler<Req>): Handler<Req> =>
  async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!respondWithStockError(res, error)) {
        throw error;
      }
    }
  };
