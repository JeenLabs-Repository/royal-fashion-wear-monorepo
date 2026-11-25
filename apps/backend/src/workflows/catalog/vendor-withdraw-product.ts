import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  emitEventStep,
  linkProductsToSalesChannelWorkflow,
} from "@medusajs/medusa/core-flows";
import { recordAuditStep } from "../../lib/audit/record-audit-step";
import { getDefaultSalesChannelId } from "../../lib/catalog/default-sales-channel";
import { getQuery } from "../../lib/catalog/load-content";
import {
  assertTransitionStep,
  loadOwnedSubmissionStep,
  setCoreStatusStep,
  transitionSubmissionStep,
} from "../steps/catalog/transition-submission";
import {
  pendingOnlyUploadsStep,
  releaseUploadsStep,
} from "../steps/catalog/validate-content-refs";

// Decision 0021: unlink already emits product.updated, so storefront revalidation needs no help.
const EMIT_PRODUCT_UPDATED_AFTER_UNLINK = false;

export type VendorWithdrawProductInput = {
  vendor_id: string;
  product_id: string;
  actor: { id: string; label: string };
};

type Row = Record<string, any>;

// Removes the product from the default sales channel when it is linked. The compensation
// links it again.
const unlinkFromDefaultChannelStep = createStep(
  "unlink-from-default-channel",
  async (input: { product_id: string }, { container }) => {
    const channelId = await getDefaultSalesChannelId(container);
    const { data } = await getQuery(container).graph({
      entity: "product",
      fields: ["id", "sales_channels.id"],
      filters: { id: input.product_id },
    });
    const linked = ((data[0]?.sales_channels ?? []) as Row[]).some(
      (channel) => channel.id === channelId
    );
    if (linked) {
      await linkProductsToSalesChannelWorkflow(container).run({
        input: { id: channelId, remove: [input.product_id] },
      });
    }
    return new StepResponse(
      { unlinked: linked },
      linked ? { product_id: input.product_id, channel_id: channelId } : undefined
    );
  },
  async (compensation, { container }) => {
    if (compensation) {
      await linkProductsToSalesChannelWorkflow(container).run({
        input: { id: compensation.channel_id, add: [compensation.product_id] },
      });
    }
  }
);

/**
 * The vendor takes a product off sale. Only ownership is needed, not eligibility: a vendor whose
 * agreement went stale may still pull its own product, and the vendor chain already refuses
 * suspended vendors. The submission becomes withdrawn, the product leaves the sales channel
 * and goes back to the core status `draft`. Only staff publish a product again.
 */
export const vendorWithdrawProductWorkflow = createWorkflow(
  "vendor-withdraw-product",
  function (input: VendorWithdrawProductInput) {
    const loaded = loadOwnedSubmissionStep({
      vendor_id: input.vendor_id,
      product_id: input.product_id,
    });
    assertTransitionStep({ submission_id: loaded.submission_id, event: "withdraw" });
    const pendingOnly = pendingOnlyUploadsStep({ product_id: input.product_id });

    const transitioned = transitionSubmissionStep({
      submission_id: loaded.submission_id,
      vendor_id: input.vendor_id,
      event: "withdraw",
      hidden_by_suspension: false,
    });
    unlinkFromDefaultChannelStep({ product_id: input.product_id });
    setCoreStatusStep({ product_id: input.product_id, status: "draft" });
    releaseUploadsStep({ upload_ids: pendingOnly.upload_ids });

    when({ flag: EMIT_PRODUCT_UPDATED_AFTER_UNLINK }, ({ flag }) => flag === true).then(() => {
      emitEventStep({ eventName: "product.updated", data: { id: input.product_id } }).config({
        name: "emit-product-updated-after-unlink",
      });
    });

    // The audit row is written last: a written row cannot be rolled back.
    const auditInput = transform({ input, transitioned }, ({ input, transitioned }) => ({
      action: "product.withdrawn" as const,
      actor: { id: input.actor.id, type: "vendor" as const, label: input.actor.label },
      target: { type: "product", id: input.product_id },
      before: transitioned.before,
      after: transitioned.after,
    }));
    recordAuditStep(auditInput);

    const emitted = transform({ input, transitioned }, ({ input, transitioned }) => ({
      eventName: "catalog.withdrawn",
      data: {
        submission_id: transitioned.submission_id,
        product_id: input.product_id,
        vendor_id: input.vendor_id,
      },
    }));
    emitEventStep(emitted);

    return new WorkflowResponse(transitioned);
  }
);
