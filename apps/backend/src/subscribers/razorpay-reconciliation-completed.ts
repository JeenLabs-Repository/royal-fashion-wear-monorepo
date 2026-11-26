import type { MedusaContainer, SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { RAZORPAY_EVENTS } from "@jeenlabs-repository/medusa-payment-razorpay/public";
import { auditPayment, notifyStaff } from "../lib/payments/staff-hooks";

const TAG = "[razorpay-reconciliation]";

export type ReconciliationCompletedData = {
  run_id: string;
  mismatch_count: number;
  scanned_count: number;
  truncated: boolean;
  date_ist: string;
};

type HandlerLogger = { warn(message: string): void; error(message: string): void };

const isCompletedData = (value: unknown): value is ReconciliationCompletedData => {
  const data = value as Partial<ReconciliationCompletedData> | null;
  return (
    !!data &&
    typeof data.run_id === "string" &&
    data.run_id.length > 0 &&
    Number.isInteger(data.mismatch_count) &&
    Number.isInteger(data.scanned_count) &&
    typeof data.truncated === "boolean" &&
    typeof data.date_ist === "string" &&
    data.date_ist.length > 0
  );
};

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "unknown error";

/**
 * Every completed run is audited. Staff are told only when there is something
 * to look at: at least one mismatch, or a run cut short by the page limit.
 */
export async function handleReconciliationCompleted(
  container: MedusaContainer,
  data: unknown
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as unknown as HandlerLogger;
  if (!isCompletedData(data)) {
    logger.warn(`${TAG} completion event ignored: unexpected payload`);
    return;
  }

  try {
    await auditPayment(container as never, {
      action: "payment.reconciliation_run",
      target: { type: "reconciliation_run", id: data.run_id },
      meta: {
        mismatch_count: data.mismatch_count,
        scanned_count: data.scanned_count,
        truncated: data.truncated,
        date_ist: data.date_ist,
      },
    });
  } catch (error) {
    logger.error(`${TAG} audit entry failed for run ${data.run_id}: ${messageOf(error)}`);
  }

  if (data.mismatch_count === 0 && !data.truncated) {
    return;
  }

  const count = data.mismatch_count;
  const noun = count === 1 ? "mismatch" : "mismatches";
  const lines = [
    `Run ${data.run_id} compared ${data.scanned_count} gateway payments and found ${count} ${noun}.`,
  ];
  if (data.truncated) {
    lines.push(
      "The run was cut short because more than 2,000 payments were created in the window. Check the Razorpay dashboard for the rest."
    );
  }
  lines.push("Open Payment reconciliation in the Admin to review each item.");

  try {
    await notifyStaff(container as never, {
      kind: "payment-reconciliation",
      roleKeys: ["superadmin", "finance_readonly"],
      subject:
        count > 0
          ? `Payment reconciliation: ${count} ${noun} found`
          : "Payment reconciliation was cut short",
      heading:
        count > 0
          ? "The daily payment check found mismatches"
          : "The daily payment check did not cover every payment",
      lines,
      idempotencyKey: `recon:${data.date_ist}:daily`,
    });
  } catch (error) {
    logger.error(`${TAG} alert failed for run ${data.run_id}: ${messageOf(error)}`);
  }
}

export default async function razorpayReconciliationCompletedHandler({
  event,
  container,
}: SubscriberArgs<ReconciliationCompletedData>): Promise<void> {
  await handleReconciliationCompleted(container, event.data);
}

export const config: SubscriberConfig = {
  event: RAZORPAY_EVENTS.reconciliationCompleted,
};
