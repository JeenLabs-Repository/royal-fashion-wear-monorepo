import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { recordAudit, type RecordAuditInput } from "./record-audit";

// A workflow step that writes one audit row and fails closed. A written row
// cannot be removed, so there is no compensation: place this step last in a
// workflow, or accept that a rolled-back attempt leaves its row behind.
export const recordAuditStep = createStep(
  "record-audit-entry",
  async (input: RecordAuditInput, { container }) => {
    await recordAudit(container, input);
    return new StepResponse({ recorded: true });
  }
);
