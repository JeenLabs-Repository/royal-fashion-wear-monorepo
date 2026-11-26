import type { ExecArgs } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { RAZORPAY_LEDGER_MODULE } from "@jeenlabs-repository/medusa-payment-razorpay/public";

// Fixed fake ids so the script is idempotent and the browser spec can find the rows.
export const DEMO_ORPHAN_PAYMENT_ID = "pay_DEMO000000001";
export const DEMO_RESOLVED_PAYMENT_ID = "pay_DEMO000000002";

type DemoLedger = {
  startRun(input: { window_hours: number }): Promise<string>;
  addItems(
    runId: string,
    items: {
      kind: string;
      razorpay_payment_id: string | null;
      razorpay_order_id?: string | null;
      amount_paise: number;
      detail?: Record<string, unknown> | null;
    }[]
  ): Promise<number>;
  listItemsForRun(runId: string): Promise<{ id: string; razorpay_payment_id: string | null }[]>;
  markItemResolved(itemId: string, note: string): Promise<unknown>;
  finishRun(
    runId: string,
    result: { status: "completed"; scanned_count: number; mismatch_count: number }
  ): Promise<void>;
  // <RESOLVE: the generated list method for items. Command:
  // grep -o "listRazorpayReconciliationItems" node_modules/__SCOPE__/medusa-payment-razorpay/.medusa/server/src/modules/razorpay-ledger/service.d.ts | head -n 1>
  listRazorpayReconciliationItems(
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<{ run_id: string }[]>;
};

export default async function seedReconciliationDemo({ container }: ExecArgs): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "[seed-reconciliation-demo] refuses to run in production"
    );
  }

  const ledger = container.resolve(RAZORPAY_LEDGER_MODULE) as unknown as DemoLedger;

  const existing = await ledger.listRazorpayReconciliationItems(
    { razorpay_payment_id: DEMO_ORPHAN_PAYMENT_ID },
    { take: 1 }
  );
  if (existing.length > 0) {
    console.log(`[seed-reconciliation-demo] already present in run ${existing[0].run_id}`);
    return;
  }

  const runId = await ledger.startRun({ window_hours: 48 });
  await ledger.addItems(runId, [
    {
      kind: "captured_no_order",
      razorpay_payment_id: DEMO_ORPHAN_PAYMENT_ID,
      razorpay_order_id: "order_DEMO000000001",
      amount_paise: 49900,
      detail: { reason: "demo" },
    },
    {
      kind: "captured_no_order",
      razorpay_payment_id: DEMO_RESOLVED_PAYMENT_ID,
      razorpay_order_id: "order_DEMO000000002",
      amount_paise: 12900,
      detail: { reason: "demo" },
    },
  ]);

  const items = await ledger.listItemsForRun(runId);
  const resolved = items.find((item) => item.razorpay_payment_id === DEMO_RESOLVED_PAYMENT_ID);
  if (resolved) {
    await ledger.markItemResolved(resolved.id, "demo: handled by hand");
  }
  await ledger.finishRun(runId, { status: "completed", scanned_count: 2, mismatch_count: 2 });

  console.log(`[seed-reconciliation-demo] created run ${runId}`);
}
