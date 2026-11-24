import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { auditVendorEventStep } from "../../lib/vendor/audit";
import { assertActivatableStep } from "./steps/assert-activatable";
import { reconcileChannelLinksStep } from "./steps/reconcile-channel-links";
import { setVendorStatusStep } from "./steps/set-vendor-status";
import { vendorActivationGateWorkflow } from "./vendor-activation-gate";

export type ActivateVendorInput = {
  vendor_id: string;
  actor: { id: string; label?: string };
};

export const activateVendorWorkflow = createWorkflow(
  "activate-vendor",
  function (input: ActivateVendorInput) {
    assertActivatableStep({ vendor_id: input.vendor_id });

    // Runs the hook before anything changes, so a blocking handler leaves the
    // vendor and its links exactly as they were.
    vendorActivationGateWorkflow.runAsStep({
      input: { vendor_id: input.vendor_id, trigger: "activation" as const },
    });

    const statusChange = setVendorStatusStep({
      vendor_id: input.vendor_id,
      status: "active" as const,
      set_activated_at_if_null: true,
      clear_suspension: true,
    });
    const links = reconcileChannelLinksStep({ vendor_id: input.vendor_id });

    const auditInput = transform({ input, statusChange }, (data) => ({
      event: {
        action: "vendor.activated" as const,
        target_id: data.input.vendor_id,
        actor: {
          type: "user" as const,
          id: data.input.actor.id,
          label: data.input.actor.label,
        },
        before: { status: data.statusChange.previous_status },
        after: { status: "active" },
      },
    }));
    auditVendorEventStep(auditInput);

    return new WorkflowResponse({ vendor_id: input.vendor_id, links });
  }
);
