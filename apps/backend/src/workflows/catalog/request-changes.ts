import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { acquireLockStep, emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows";
import { recordAuditStep } from "../../lib/audit/record-audit-step";
import {
  decisionLockKey,
  finalizeDecisionStep,
  loadDecisionStep,
  setDecisionCoreStatusStep,
  validateReasonStep,
} from "../steps/catalog/decision-steps";

export type RequestChangesInput = {
  submission_id: string;
  actor: { id: string; label: string | null };
  body: { content_hash: string; reason: string };
};

/**
 * Sends a submission back to the vendor. A new product returns to core status `draft`; a live
 * edit stays pending for the vendor to change and the live product is left alone.
 */
export const requestChangesWorkflow = createWorkflow(
  "request-changes",
  function (input: RequestChangesInput) {
    const lockKey = transform({ input }, ({ input }) => decisionLockKey(input.submission_id));
    acquireLockStep({ key: lockKey, timeout: 10, ttl: 60 });

    const loaded = loadDecisionStep({
      submission_id: input.submission_id,
      content_hash: input.body.content_hash,
      event: "request_changes",
    });
    const cleaned = validateReasonStep({ reason: input.body.reason });

    when({ loaded }, ({ loaded }) => loaded.is_live === false).then(() => {
      setDecisionCoreStatusStep({ product_id: loaded.product_id, status: "draft" });
    });

    const finalized = finalizeDecisionStep({
      submission_id: input.submission_id,
      event: "request_changes",
      reviewer_user_id: input.actor.id,
      reason: cleaned.reason,
    });

    const auditInput = transform({ input, loaded, cleaned, finalized }, (data) => ({
      action: "product.changes_requested" as const,
      actor: { id: data.input.actor.id, type: "user" as const, label: data.input.actor.label },
      target: { type: "product", id: data.loaded.product_id },
      before: { state: data.finalized.before.state, is_live: data.finalized.before.is_live },
      after: {
        state: data.finalized.after.state,
        is_live: data.finalized.after.is_live,
        reason: data.cleaned.reason,
        content_hash: data.input.body.content_hash,
      },
      meta: { approver_edits: data.loaded.approver_edits },
    }));
    recordAuditStep(auditInput);
    releaseLockStep({ key: lockKey });

    const emitted = transform({ finalized }, ({ finalized }) => ({
      eventName: "catalog.changes_requested",
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
