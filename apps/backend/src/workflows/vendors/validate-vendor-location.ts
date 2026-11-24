import {
  createHook,
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { loadVendor } from "../../lib/vendor/eligibility";
import type { VendorLocationValidatingPayload } from "../../modules/vendor/hook-types";

const confirmVendorForLocationStep = createStep(
  "confirm-vendor-for-location",
  async (input: { vendor_id: string }, { container }) => {
    const vendor = await loadVendor(container, input.vendor_id);
    return new StepResponse({ vendor_id: vendor.id });
  }
);

// Hosts the hook a plugin uses to add rules to a location, for example a
// stricter address check. A handler that throws a MedusaError stops the create
// or update and its message reaches the owner unchanged. Both location
// workflows run this before they create or change anything.
export const vendorLocationValidationWorkflow = createWorkflow(
  "vendor-location-validation",
  function (input: VendorLocationValidatingPayload) {
    confirmVendorForLocationStep({ vendor_id: input.vendor_id });
    const vendorLocationValidating = createHook("vendorLocationValidating", {
      vendor_id: input.vendor_id,
      operation: input.operation,
      location_id: input.location_id,
      proposed: input.proposed,
    });
    return new WorkflowResponse(
      { vendor_id: input.vendor_id },
      { hooks: [vendorLocationValidating] }
    );
  }
);
