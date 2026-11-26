import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import {
  RAZORPAY_LEDGER_MODULE,
  refundOrphanRazorpayPaymentWorkflow,
} from "@jeenlabs-repository/medusa-payment-razorpay/public";
import {
  emptyBodySchema,
  parseInput,
  type LedgerReader,
} from "../../../../../../../lib/payments/razorpay-admin-views";

// Plugin error codes that mean "someone already did this or is doing it now".
const CONFLICT_CODES = ["razorpay_refund_in_progress", "razorpay_item_resolved"];

const codeOf = (error: unknown): string => {
  const failure = error as { code?: unknown; message?: unknown } | null;
  const haystack = `${String(failure?.code ?? "")} ${String(failure?.message ?? "")}`;
  return CONFLICT_CODES.find((code) => haystack.includes(code)) ?? "";
};

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  parseInput(emptyBodySchema, req.body);
  const itemId = req.params.item_id;
  const ledger = req.scope.resolve(RAZORPAY_LEDGER_MODULE) as unknown as LedgerReader;

  const item = await ledger.getItem(itemId);
  if (!item) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Reconciliation item not found");
  }
  if (item.resolved_at) {
    throw new MedusaError(MedusaError.Types.CONFLICT, "This item is already resolved");
  }
  if (item.kind !== "captured_no_order" || !item.razorpay_payment_id) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Only a payment captured without an order can be refunded from here"
    );
  }

  let refundId: string | null = null;
  try {
    // <RESOLVE: confirm the workflow rethrows the original error with throwOnError. Command:
    // grep -rn "throwOnError" node_modules/@medusajs/workflows-sdk/dist/helper/workflow-export.d.ts | head -n 3>
    const { result } = await refundOrphanRazorpayPaymentWorkflow(req.scope).run({
      input: { item_id: itemId },
      throwOnError: true,
    });
    if (result.status === "already_resolved") {
      throw new MedusaError(MedusaError.Types.CONFLICT, "This item is already resolved");
    }
    refundId = result.razorpay_refund_id;
  } catch (error) {
    if (error instanceof MedusaError && error.type === MedusaError.Types.CONFLICT) {
      throw error;
    }
    if (codeOf(error)) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "A refund for this payment is already being processed"
      );
    }
    throw error;
  }

  // The ledger row is written by the plugin before the workflow returns.
  const rows = await ledger.listRefundsForPayment(item.razorpay_payment_id);
  const row = rows.find((candidate) => candidate.razorpay_refund_id === refundId);
  res.json({ razorpay_refund_id: refundId, status: row?.status ?? "requested" });
}
