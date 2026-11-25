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

export type RejectSubmissionInput = {
  submission_id: string;
  actor: { id: string; label: string | null };
  body: { content_hash: string; reason: string };
};

/**
 * Rejects a submission. A new product becomes final (`rejected` state, core status `rejected`).
 * A live edit goes back to approved with its pending revision dropped, and the live product
 * keeps selling untouched. Eligibility is not checked: staff may always decide.
 */
export const rejectSubmissionWorkflow = createWorkflow(
  "reject-submission",
  function (input: RejectSubmissionInput) {
    const lockKey = transform({ input }, ({ input }) => decisionLockKey(input.submission_id));
    acquireLockStep({ key: lockKey, timeout: 10, ttl: 60 });

    const loaded = loadDecisionStep({
      submission_id: input.submission_id,
      content_hash: input.body.content_hash,
      event: "reject",
    });
    const cleaned = validateReasonStep({ reason: input.body.reason });

    when({ loaded }, ({ loaded }) => loaded.is_live === false).then(() => {
      setDecisionCoreStatusStep({ product_id: loaded.product_id, status: "rejected" });
    });

    const finalized = finalizeDecisionStep({
      submission_id: input.submission_id,
      event: "reject",
      reviewer_user_id: input.actor.id,
      reason: cleaned.reason,
    });

    const auditInput = transform({ input, loaded, cleaned, finalized }, (data) => ({
      action: "product.rejected" as const,
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
      eventName: "catalog.rejected",
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
