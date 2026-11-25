import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { acquireLockStep, emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows";
import { recordAuditStep } from "../../lib/audit/record-audit-step";
import type { ApproveBody } from "../../lib/catalog/middlewares/review-decisions";
import { assignPlatformIdentifiersStep } from "../steps/catalog/assign-platform-identifiers";
import {
  assertDecisionEligibleStep,
  decisionLockKey,
  finalizeDecisionStep,
  linkDefaultChannelStep,
  loadDecisionStep,
  toPlatformPrices,
  validateApprovalStep,
  writeApprovalToCoreStep,
} from "../steps/catalog/decision-steps";

export type ApproveProductInput = {
  submission_id: string;
  actor: { id: string; label: string | null };
  body: ApproveBody;
};

/**
 * First approval of a product that is not live. One lock per submission serialises concurrent
 * decisions. Order inside the lock: position and hash, eligibility, validation (nothing has been
 * written yet), identifiers, core writes through core workflows, the submission row, the audit
 * entry. The audit step is last because a written row cannot be rolled back.
 */
export const approveProductWorkflow = createWorkflow(
  "approve-product",
  function (input: ApproveProductInput) {
    const lockKey = transform({ input }, ({ input }) => decisionLockKey(input.submission_id));
    acquireLockStep({ key: lockKey, timeout: 10, ttl: 60 });

    const loaded = loadDecisionStep({
      submission_id: input.submission_id,
      content_hash: input.body.content_hash,
      event: "approve",
      live: false,
    });
    assertDecisionEligibleStep({ vendor_id: loaded.vendor_id });
    const validated = validateApprovalStep({
      submission_id: input.submission_id,
      product_id: loaded.product_id,
      live: false,
      body: input.body,
    });
    const identifiers = assignPlatformIdentifiersStep({
      product_id: loaded.product_id,
      title: validated.title,
      assign_handle: true,
    });
    const written = writeApprovalToCoreStep({
      product_id: loaded.product_id,
      handle: identifiers.handle,
      publish: true,
      gst_class: input.body.gst_class,
      hsn: input.body.hsn,
      category_id: input.body.category_id,
      origin_country: validated.origin_country,
      skus: identifiers.skus,
      prices_by_sku: validated.prices_by_sku,
    });
    linkDefaultChannelStep({ product_id: loaded.product_id });

    const confirmed = transform({ input }, ({ input }) => ({
      category_id: input.body.category_id,
      gst_class: input.body.gst_class,
      hsn: input.body.hsn,
    }));
    const finalized = finalizeDecisionStep({
      submission_id: input.submission_id,
      event: "approve",
      reviewer_user_id: input.actor.id,
      approved_content_hash: input.body.content_hash,
      confirmed,
    });

    const auditInput = transform(
      { input, loaded, validated, written, finalized },
      ({ input, loaded, validated, written, finalized }) => ({
        action: "product.approved" as const,
        actor: { id: input.actor.id, type: "user" as const, label: input.actor.label },
        target: { type: "product", id: loaded.product_id },
        before: {
          state: finalized.before.state,
          category_id: loaded.proposed_category_id,
          gst_class: loaded.proposed_gst_class,
          hsn: loaded.proposed_hsn,
        },
        after: {
          state: finalized.after.state,
          checklist: input.body.checklist,
          content_hash: input.body.content_hash,
          category_id: input.body.category_id,
          gst_class: input.body.gst_class,
          hsn: input.body.hsn,
          selling_prices: toPlatformPrices(validated.selling_prices, written.platform_skus),
        },
        meta: { approver_edits: loaded.approver_edits },
      })
    );
    recordAuditStep(auditInput);
    releaseLockStep({ key: lockKey });

    const emitted = transform({ finalized }, ({ finalized }) => ({
      eventName: "catalog.approved",
      data: {
        submission_id: finalized.submission_id,
        product_id: finalized.product_id,
        vendor_id: finalized.vendor_id,
        revision: finalized.revision,
      },
    }));
    emitEventStep(emitted);

    return new WorkflowResponse(finalized);
  }
);
