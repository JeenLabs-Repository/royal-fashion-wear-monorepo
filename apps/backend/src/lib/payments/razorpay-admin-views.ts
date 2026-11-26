import { MedusaError } from "@medusajs/framework/utils";
import { z } from "zod";
import { fromPaise } from "@jeenlabs-repository/medusa-payment-razorpay/public";

const HOUR_MS = 60 * 60 * 1000;

type DateLike = Date | string | null | undefined;

export type RunRow = {
  id: string;
  started_at: DateLike;
  finished_at: DateLike;
  status: string;
  scanned_count: number;
  mismatch_count: number;
  truncated: boolean;
};

export type ItemRow = {
  id: string;
  kind: string;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  medusa_payment_id: string | null;
  payment_session_id: string | null;
  amount_paise: number;
  resolved_at: DateLike;
  resolved_note: string | null;
};

export type RefundRow = {
  razorpay_refund_id: string;
  razorpay_payment_id: string;
  amount_paise: number;
  status: string;
  created_at: DateLike;
  updated_at: DateLike;
};

/**
 * The slice of the plugin ledger service the routes use.
 * <RESOLVE: the generated list method for runs. Command:
 * grep -o "listRazorpayReconciliationRuns" node_modules/__SCOPE__/medusa-payment-razorpay/.medusa/server/src/modules/razorpay-ledger/service.d.ts | head -n 1>
 */
export type LedgerReader = {
  listRuns(options?: { limit?: number }): Promise<RunRow[]>;
  listRazorpayReconciliationRuns(
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<RunRow[]>;
  listItemsForRun(runId: string): Promise<ItemRow[]>;
  getItem(itemId: string): Promise<ItemRow | null>;
  listRefundsForPayment(paymentId: string): Promise<RefundRow[]>;
};

export const listQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
  .strict();

export const refundsQuerySchema = z
  .object({ payment_id: z.string().min(1).max(64) })
  .strict();

export const emptyBodySchema = z.object({}).strict();

/** Parses a request part and answers a 400 that names the first problem. */
export const parseInput = <S extends z.ZodType>(schema: S, value: unknown): z.output<S> => {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".");
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      where ? `${where}: ${issue.message}` : (issue?.message ?? "Invalid request")
    );
  }
  return parsed.data;
};

const iso = (value: DateLike): string | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const ageHours = (startedAt: DateLike, now: Date): number => {
  const started = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  return Number.isNaN(started) ? 0 : Math.max(0, Math.floor((now.getTime() - started) / HOUR_MS));
};

export const toRunView = (row: RunRow) => ({
  id: row.id,
  started_at: iso(row.started_at),
  finished_at: iso(row.finished_at),
  status: row.status,
  scanned_count: row.scanned_count,
  mismatch_count: row.mismatch_count,
  truncated: row.truncated,
});

export const toItemView = (row: ItemRow, runStartedAt: DateLike, now: Date) => ({
  id: row.id,
  kind: row.kind,
  razorpay_payment_id: row.razorpay_payment_id,
  razorpay_order_id: row.razorpay_order_id,
  medusa_payment_id: row.medusa_payment_id,
  payment_session_id: row.payment_session_id,
  amount_paise: row.amount_paise,
  amount_inr: fromPaise(row.amount_paise),
  age_hours: ageHours(runStartedAt, now),
  resolved_at: iso(row.resolved_at),
  resolved_note: row.resolved_note,
  refundable:
    row.kind === "captured_no_order" && !row.resolved_at && Boolean(row.razorpay_payment_id),
});

export const toRefundView = (row: RefundRow) => ({
  razorpay_refund_id: row.razorpay_refund_id,
  razorpay_payment_id: row.razorpay_payment_id,
  amount_paise: row.amount_paise,
  amount_inr: fromPaise(row.amount_paise),
  status: row.status,
  created_at: iso(row.created_at),
  updated_at: iso(row.updated_at),
});
