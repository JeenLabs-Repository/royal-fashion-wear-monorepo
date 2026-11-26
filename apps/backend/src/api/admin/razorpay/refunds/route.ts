import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import {
  RAZORPAY_LEDGER_MODULE,
  RAZORPAY_PROVIDER_ID,
} from "@jeenlabs-repository/medusa-payment-razorpay/public";
import {
  parseInput,
  refundsQuerySchema,
  toRefundView,
  type LedgerReader,
} from "../../../../lib/payments/razorpay-admin-views";

type PaymentLookup = {
  retrievePayment(
    id: string,
    config?: { select?: string[] }
  ): Promise<{ id: string; provider_id?: string; data?: Record<string, unknown> | null }>;
};

// Lists the ledger rows of one Medusa payment. Payments of another provider and
// payments the gateway has not seen yet have no rows, so they answer an empty list.
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { payment_id: paymentId } = parseInput(refundsQuerySchema, req.query);

  // <RESOLVE: confirm retrievePayment accepts a select list and throws NOT_FOUND for an unknown id. Command:
  // grep -n "retrievePayment" node_modules/@medusajs/types/dist/payment/service.d.ts | head -n 3>
  const payments = req.scope.resolve(Modules.PAYMENT) as unknown as PaymentLookup;
  const payment = await payments.retrievePayment(paymentId, {
    select: ["id", "provider_id", "data"],
  });

  const gatewayId = payment.data?.razorpay_payment_id;
  if (payment.provider_id !== RAZORPAY_PROVIDER_ID || typeof gatewayId !== "string") {
    res.json({ refunds: [] });
    return;
  }

  const ledger = req.scope.resolve(RAZORPAY_LEDGER_MODULE) as unknown as LedgerReader;
  const rows = await ledger.listRefundsForPayment(gatewayId);
  res.json({ refunds: rows.map(toRefundView) });
}
