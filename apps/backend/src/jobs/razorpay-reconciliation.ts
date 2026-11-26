import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  readRazorpayCredentials,
  reconcileRazorpayPaymentsWorkflow,
} from "@jeenlabs-repository/medusa-payment-razorpay/public";
import { notifyStaff } from "../lib/payments/staff-hooks";

const TAG = "[razorpay-reconciliation]";
const MAX_REASON_LENGTH = 200;

type JobLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

const messageOf = (error: unknown): string =>
  (error instanceof Error && error.message ? error.message : "unknown error").slice(
    0,
    MAX_REASON_LENGTH
  );

/** The calendar date in India, used in alert keys so a retry on the same day is one alert. */
export const istDate = (now: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

/**
 * Runs the plugin's reconciliation once. An unconfigured payments card is a
 * skip, not a failure. A workflow error is logged and alerted once per day;
 * the function itself never throws so one bad run does not stop the scheduler.
 */
export async function runReconciliationJob(
  container: MedusaContainer,
  now: Date = new Date()
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as unknown as JobLogger;

  // <RESOLVE: confirm the shape readRazorpayCredentials returns. Command:
  // grep -n "CredentialResult" -B1 -A6 node_modules/__SCOPE__/medusa-payment-razorpay/.medusa/server/src/lib/razorpay/client.d.ts>
  let configured = false;
  try {
    const result = (await readRazorpayCredentials(container as never)) as {
      credentials?: unknown;
    };
    configured = Boolean(result?.credentials);
  } catch (error) {
    logger.error(`${TAG} could not read the payments card: ${messageOf(error)}`);
    return;
  }
  if (!configured) {
    logger.info(`${TAG} payments card is not configured, skipping`);
    return;
  }

  try {
    await reconcileRazorpayPaymentsWorkflow(container).run({
      input: {},
      throwOnError: true,
    });
  } catch (error) {
    logger.error(`${TAG} run failed: ${messageOf(error)}`);
    try {
      await notifyStaff(container as never, {
        kind: "payment-reconciliation",
        roleKeys: ["superadmin", "finance_readonly"],
        subject: "Payment reconciliation failed",
        heading: "The daily payment check did not finish",
        lines: [
          `Reason: ${messageOf(error)}`,
          "Open Payment reconciliation in the Admin and compare today's payments with the Razorpay dashboard by hand.",
        ],
        idempotencyKey: `recon:${istDate(now)}:failed`,
      });
    } catch (alertError) {
      logger.error(`${TAG} could not send the failure alert: ${messageOf(alertError)}`);
    }
  }
}

export default async function razorpayReconciliationJob(
  container: MedusaContainer
): Promise<void> {
  await runReconciliationJob(container);
}

// Jobs run in UTC: 21:00 UTC is 02:30 in India.
export const config = {
  name: "razorpay-reconciliation",
  schedule: "0 21 * * *",
};
