import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import {
  recordAgreementAcceptanceStep,
  type RecordAgreementAcceptanceInput,
} from "./steps/record-agreement-acceptance";

export type AcceptVendorAgreementInput = RecordAgreementAcceptanceInput;

// The acceptance row is the record (version, time, address, user agent), so no
// separate audit entry is written.
export const acceptVendorAgreementWorkflow = createWorkflow(
  "accept-vendor-agreement",
  function (input: AcceptVendorAgreementInput) {
    const accepted = recordAgreementAcceptanceStep(input);
    return new WorkflowResponse(accepted);
  }
);
