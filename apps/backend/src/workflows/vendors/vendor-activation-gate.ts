import { MedusaError } from "@medusajs/framework/utils";
import {
  createHook,
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { loadVendor } from "../../lib/vendor/eligibility";
import type { VendorActivatingPayload } from "../../modules/vendor/hook-types";

const confirmVendorExistsStep = createStep(
  "confirm-vendor-exists",
  async (input: { vendor_id: string }, { container }) => {
    const vendor = await loadVendor(container, input.vendor_id);
    if (!vendor) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Vendor not found.");
    }
    return new StepResponse({ vendor_id: vendor.id });
  }
);

// Hosts the hook that a plugin uses to block activation and reactivation. A
// handler that throws a MedusaError stops the parent workflow and its message
// reaches the owner unchanged. Both activation workflows run this one first.
export const vendorActivationGateWorkflow = createWorkflow(
  "vendor-activation-gate",
  function (input: VendorActivatingPayload) {
    confirmVendorExistsStep({ vendor_id: input.vendor_id });
    const vendorActivating = createHook("vendorActivating", {
      vendor_id: input.vendor_id,
      trigger: input.trigger,
    });
    return new WorkflowResponse({ vendor_id: input.vendor_id }, { hooks: [vendorActivating] });
  }
);
