import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { resolveRoleRecipients } from "../lib/alerts/send-staff-alert";
import { getCatalogService, getQuery } from "../lib/catalog/load-content";
import { buildIdempotencyKey, sendTemplatedEmail } from "../emails/lib/send-email";

const TAG = "catalog-submitted-alert";

type SubmittedData = {
  submission_id: string;
  product_id: string;
  revision: number;
  live: boolean;
};

const trimSlash = (value: string): string => value.replace(/\/+$/, "");

// Tells every catalog approver that something waits for review. The email names the product
// title and whether it is a change to a live product; it never carries the vendor, SKUs or
// prices. The key makes a repeated event send nothing more.
export default async function catalogSubmittedAlertHandler({
  event,
  container,
}: SubscriberArgs<SubmittedData>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger;
  const { submission_id: submissionId, product_id: productId, revision, live } = event.data;

  try {
    const { data } = await getQuery(container).graph({
      entity: "product",
      fields: ["id", "title"],
      filters: { id: productId },
    });
    const title = String(data[0]?.title ?? "");
    if (!title) {
      logger.warn(`[${TAG}] Product ${productId} not found, alert not sent`);
      return;
    }

    const to = await resolveRoleRecipients(container, ["catalog_approver"]);
    if (to.length === 0) {
      logger.warn(`[${TAG}] No catalog approvers found, alert not sent for ${submissionId}`);
      return;
    }

    // The submission time keeps a resubmit without an edit (same revision) from being
    // suppressed as a duplicate of the first alert.
    const [submission] = (await getCatalogService(container).listProductSubmissions(
      { id: submissionId },
      { take: 1 }
    )) as Record<string, any>[];
    const submittedAt = new Date(submission?.submitted_at as string).getTime();
    const bucket = `${revision}-${Number.isFinite(submittedAt) ? submittedAt : 0}`;

    const adminUrl = trimSlash(process.env.ADMIN_APP_URL ?? "http://localhost:9000/app");
    const idempotencyKey = buildIdempotencyKey("product-review-needed", submissionId, bucket);
    await sendTemplatedEmail({
      container,
      template: "staff-product-review-needed",
      to,
      props: {
        product_title: title,
        is_live_edit: Boolean(live),
        review_url: `${adminUrl}/product-reviews/${submissionId}`,
      },
      idempotencyKey,
      tag: TAG,
    });
  } catch (error) {
    logger.error(`[${TAG}] failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const config: SubscriberConfig = {
  event: "catalog.submitted",
};
