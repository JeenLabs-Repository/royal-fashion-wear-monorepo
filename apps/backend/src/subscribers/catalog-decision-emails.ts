import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { buildIdempotencyKey, sendTemplatedEmail } from "../emails/lib/send-email";
import { getCatalogService, getQuery } from "../lib/catalog/load-content";
import { getVendorModule } from "../lib/vendor/vendor-module";

const TAG = "catalog-decision-emails";

type DecisionData = {
  submission_id: string;
  product_id: string;
  vendor_id: string;
  revision: number;
};

type Row = Record<string, any>;

const trimSlash = (value: string): string => value.replace(/\/+$/, "");

// One vendor email per decision, to the vendor's own user and to nobody else. The event name
// picks the template; the reason is read from the submission so it is never part of an event.
export default async function catalogDecisionEmailsHandler({
  event,
  container,
}: SubscriberArgs<DecisionData>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger;
  const { submission_id: submissionId, product_id: productId, vendor_id: vendorId, revision } = event.data;

  try {
    const [submission] = (await getCatalogService(container).listProductSubmissions(
      { id: submissionId },
      { take: 1 }
    )) as Row[];
    const [user] = (await getVendorModule(container).listVendorUsers(
      { vendor_id: vendorId },
      { take: 1 }
    )) as Row[];
    const { data } = await getQuery(container).graph({
      entity: "product",
      fields: ["id", "title"],
      filters: { id: productId },
    });
    const title = String(data[0]?.title ?? "");
    if (!submission || !user?.email || !title) {
      logger.warn(`[${TAG}] Missing submission, vendor user or product for ${submissionId}, email not sent`);
      return;
    }

    const portalUrl = `${trimSlash(process.env.VENDOR_PORTAL_URL ?? "")}/products`;
    const reason = String(submission.reason ?? "");
    // The decision time keeps a second decision at the same revision (a resubmit without an
    // edit) from being suppressed as a duplicate of the first email.
    const decidedAt = new Date(submission.decided_at as string).getTime();
    const bucket = `${revision}-${Number.isFinite(decidedAt) ? decidedAt : 0}`;
    const key = (template: string) => buildIdempotencyKey(template, submissionId, bucket);

    if (event.name === "catalog.approved" || event.name === "catalog.changes_applied") {
      await sendTemplatedEmail({
        container,
        template: "vendor-product-approved",
        to: String(user.email),
        props: {
          product_title: title,
          is_live_edit: event.name === "catalog.changes_applied",
          portal_url: portalUrl,
        },
        idempotencyKey: key("vendor-product-approved"),
        tag: TAG,
      });
    } else if (event.name === "catalog.rejected") {
      await sendTemplatedEmail({
        container,
        template: "vendor-product-rejected",
        to: String(user.email),
        props: { product_title: title, reason, portal_url: portalUrl },
        idempotencyKey: key("vendor-product-rejected"),
        tag: TAG,
      });
    } else if (event.name === "catalog.changes_requested") {
      await sendTemplatedEmail({
        container,
        template: "vendor-product-changes-requested",
        to: String(user.email),
        props: { product_title: title, reason, portal_url: portalUrl },
        idempotencyKey: key("vendor-product-changes-requested"),
        tag: TAG,
      });
    }
  } catch (error) {
    logger.error(`[${TAG}] failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const config: SubscriberConfig = {
  event: [
    "catalog.approved",
    "catalog.changes_applied",
    "catalog.rejected",
    "catalog.changes_requested",
  ],
};
