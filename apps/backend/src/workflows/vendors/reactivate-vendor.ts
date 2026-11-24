import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { auditVendorEventStep } from "../../lib/vendor/audit";
import { assertReactivatableStep } from "./steps/assert-activatable";
import { reconcileChannelLinksStep } from "./steps/reconcile-channel-links";
import { setVendorStatusStep } from "./steps/set-vendor-status";
import { vendorActivationGateWorkflow } from "./vendor-activation-gate";

export type ReactivateVendorInput = {
  vendor_id: string;
  reason: string;
  actor: { id: string; label?: string };
};

export const reactivateVendorWorkflow = createWorkflow(
  "reactivate-vendor",
  function (input: ReactivateVendorInput) {
    const checked = assertReactivatableStep({
      vendor_id: input.vendor_id,
      reason: input.reason,
    });

    // The same hook as activation, so a plugin rule applies again.
    vendorActivationGateWorkflow.runAsStep({
      input: { vendor_id: input.vendor_id, trigger: "reactivation" as const },
    });

    const statusChange = setVendorStatusStep({
      vendor_id: input.vendor_id,
      status: "active" as const,
      set_activated_at_if_null: true,
      clear_suspension: true,
    });
    const links = reconcileChannelLinksStep({ vendor_id: input.vendor_id });

    const auditInput = transform({ input, checked, statusChange }, (data) => ({
      event: {
        action: "vendor.reactivated" as const,
        target_id: data.input.vendor_id,
        actor: {
          type: "user" as const,
          id: data.input.actor.id,
          label: data.input.actor.label,
        },
        before: { status: data.statusChange.previous_status },
        after: { status: "active" },
        meta: { reason: data.checked.reason },
      },
    }));
    auditVendorEventStep(auditInput);

    return new WorkflowResponse({ vendor_id: input.vendor_id, links });
  }
);
