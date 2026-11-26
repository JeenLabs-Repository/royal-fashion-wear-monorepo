import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { RAZORPAY_LEDGER_MODULE } from "@jeenlabs-repository/medusa-payment-razorpay/public";
import {
  emptyBodySchema,
  parseInput,
  toItemView,
  toRunView,
  type LedgerReader,
} from "../../../../../lib/payments/razorpay-admin-views";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  parseInput(emptyBodySchema, req.query);
  const runId = req.params.run_id;
  const ledger = req.scope.resolve(RAZORPAY_LEDGER_MODULE) as unknown as LedgerReader;

  const [run] = await ledger.listRazorpayReconciliationRuns({ id: runId }, { take: 1 });
  if (!run) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Reconciliation run not found");
  }

  const now = new Date();
  const items = await ledger.listItemsForRun(runId);
  res.json({
    run: toRunView(run),
    items: items.map((item) => toItemView(item, run.started_at, now)),
  });
}
