// Closes a break-glass review. The closer has to be a different superadmin than
// the account that used break-glass, confirm that the credentials were rotated,
// and leave a note of at least 10 characters. The audit entry records the note
// length only, never the note.

import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { recordAuditStep } from "../lib/audit/record-audit-step";
import {
  closeBreakGlassReviewStep,
  validateCloseBreakGlassReviewStep,
  type CloseBreakGlassReviewStepInput,
} from "./steps/break-glass-review-steps";

export type CloseBreakGlassReviewInput = CloseBreakGlassReviewStepInput;

export const closeBreakGlassReviewWorkflow = createWorkflow(
  "close-break-glass-review",
  function (input: CloseBreakGlassReviewInput) {
    const checked = validateCloseBreakGlassReviewStep(input);

    const closed = closeBreakGlassReviewStep(
      transform({ input, checked }, ({ input, checked }) => ({
        review_id: input.review_id,
        closed_by: input.closer.id,
        note: checked.note,
      }))
    );

    recordAuditStep(
      transform({ input, checked }, (data) => ({
        action: "break_glass.reviewed" as const,
        actor: {
          id: data.input.closer.id,
          type: "user" as const,
          label: data.input.closer.label,
          roles: ["superadmin"],
        },
        target: { type: "break_glass_review", id: data.input.review_id },
        before: { status: "open" },
        after: { status: "closed", rotated_confirmed: true },
        meta: { note_length: data.checked.note.length },
      }))
    );

    return new WorkflowResponse(closed);
  }
);

export default closeBreakGlassReviewWorkflow;
