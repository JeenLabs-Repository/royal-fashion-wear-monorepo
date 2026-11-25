import type { MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { respondWithCatalogError } from "./errors";

// Codes that only the decision workflows raise. Catalog codes such as `invalid_transition`
// and `variant_has_stock_or_orders` stay in the catalog table.
export const DECISION_ERROR_STATUS = {
  stale_revision: 409,
  checklist_incomplete: 400,
  price_missing: 400,
  price_above_mrp: 400,
  reason_too_short: 400,
} as const;

export type DecisionErrorCode = keyof typeof DECISION_ERROR_STATUS;

type Extra = Record<string, unknown>;

export class DecisionError extends MedusaError {
  readonly extra: Extra;

  constructor(code: DecisionErrorCode, message: string, extra: Extra = {}) {
    super(
      DECISION_ERROR_STATUS[code] === 409
        ? MedusaError.Types.CONFLICT
        : MedusaError.Types.INVALID_DATA,
      message,
      code
    );
    this.extra = extra;
  }
}

export const decisionError = (code: DecisionErrorCode, message: string, extra: Extra = {}) =>
  new DecisionError(code, message, extra);

// A vendor that is not eligible is a 403 for the vendor's own actions and a 409 for a staff
// decision: the approver did nothing wrong, the state of the vendor blocks the decision.
const STATUS_BY_CODE: Record<string, number> = {
  ...DECISION_ERROR_STATUS,
  vendor_not_eligible: 409,
};

export function respondWithDecisionError(res: MedusaResponse, error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown; extra?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : undefined;
  if (code && code in STATUS_BY_CODE) {
    const status = STATUS_BY_CODE[code];
    res.status(status).json({
      type: status === 409 ? "conflict" : "invalid_data",
      code,
      message: String(candidate?.message ?? ""),
      ...((candidate?.extra as Extra | undefined) ?? {}),
    });
    return true;
  }
  return respondWithCatalogError(res, error);
}

type Handler<Req> = (req: Req, res: MedusaResponse) => Promise<void>;

/** Wraps a decision route so decision and catalog errors answer with their own status. */
export const withDecisionErrors =
  <Req>(handler: Handler<Req>): Handler<Req> =>
  async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!respondWithDecisionError(res, error)) {
        throw error;
      }
    }
  };
