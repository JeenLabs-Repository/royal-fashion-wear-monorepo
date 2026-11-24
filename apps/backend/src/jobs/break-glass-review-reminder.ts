// Reminds the alert recipients, once a day at 09:00 India time, while a
// break-glass review has been open for more than 24 hours. It sends mail and
// nothing else: the account and every assignment stay as they are, and the
// account is never disabled automatically.

import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { buildIdempotencyKey, sendTemplatedEmail } from "../emails/lib/send-email";
import { getBreakGlassAlertRecipients } from "../lib/break-glass/parse-alert-emails";
import { findStaleOpenReviews, type ReviewLike } from "../lib/break-glass/stale-reviews";
import { formatIst, istDate } from "../lib/break-glass/time";
import { STAFF_ACCESS_MODULE } from "../modules/staff-access";

type StaffAccessApi = {
  listBreakGlassReviews(
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<ReviewLike[]>;
};

const STALE_AFTER_HOURS = 24;

export default async function breakGlassReviewReminderJob(container: MedusaContainer) {
  const logger = container.resolve<{
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  }>(ContainerRegistrationKeys.LOGGER);

  try {
    const now = new Date();
    const stale = await findStaleOpenReviews(
      container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE),
      now,
      STALE_AFTER_HOURS
    );
    if (stale.length === 0) {
      return;
    }

    const recipients = getBreakGlassAlertRecipients(process.env);
    if (recipients.length === 0) {
      logger.warn("[break-glass] reminder skipped: no valid BREAK_GLASS_ALERT_EMAILS configured");
      return;
    }

    const oldest = stale[0];
    const openedAt = new Date(oldest.opened_at);
    const adminUrl = (process.env.ADMIN_APP_URL || "http://localhost:9000/app").replace(/\/+$/, "");

    const sent = await sendTemplatedEmail({
      container,
      template: "break-glass-review-reminder",
      to: recipients,
      props: {
        openedAtIst: formatIst(openedAt),
        hoursOpen: Math.floor((now.getTime() - openedAt.getTime()) / 3_600_000),
        reviewUrl: `${adminUrl}/staff`,
      },
      idempotencyKey: buildIdempotencyKey("break-glass-reminder", oldest.id, istDate(now)),
      tag: "break-glass",
    });
    logger.info(`[break-glass] reminder for review ${oldest.id} ${sent ? "sent" : "not sent"}`);
  } catch (error) {
    // Never throw: the job runs again tomorrow.
    logger.error(
      `[break-glass] reminder job failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export const config = {
  name: "break-glass-review-reminder",
  // 03:30 UTC is 09:00 India time. This assumes the server runs in UTC; the
  // production configuration audit checks the container time zone.
  schedule: "30 3 * * *",
};
