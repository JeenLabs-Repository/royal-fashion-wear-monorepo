import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { RAZORPAY_LEDGER_MODULE } from "@jeenlabs-repository/medusa-payment-razorpay/public";
import {
  listQuerySchema,
  parseInput,
  toRunView,
  type LedgerReader,
} from "../../../../lib/payments/razorpay-admin-views";

// Newest first. The ledger service sorts; this route only validates and serializes.
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { limit } = parseInput(listQuerySchema, req.query);
  const ledger = req.scope.resolve(RAZORPAY_LEDGER_MODULE) as unknown as LedgerReader;
  const rows = await ledger.listRuns({ limit });
  res.json({ runs: rows.map(toRunView) });
}
