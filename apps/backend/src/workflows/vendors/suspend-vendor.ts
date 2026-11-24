import {
  createHook,
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { assertSuspendableStep } from "./steps/assert-activatable";
import { auditVendorEventStep } from "../../lib/vendor/audit";
import { reconcileChannelLinksStep } from "./steps/reconcile-channel-links";
import { setVendorStatusStep } from "./steps/set-vendor-status";

export type SuspendVendorInput = {
  vendor_id: string;
  reason: string;
  actor: { id: string; label?: string };
};

// Order matters. The status changes first, then every location leaves the
// sales channel, then the cleanup hook runs, so a handler always sees a
// suspended vendor and nothing visible to customers.
export const suspendVendorWorkflow = createWorkflow(
  "suspend-vendor",
  function (input: SuspendVendorInput) {
    const checked = assertSuspendableStep({
      vendor_id: input.vendor_id,
      reason: input.reason,
    });

    const statusChange = setVendorStatusStep({
      vendor_id: input.vendor_id,
      status: "suspended" as const,
      reason: input.reason,
    });
    // The vendor is no longer active, so this unlinks every location.
    const links = reconcileChannelLinksStep({ vendor_id: input.vendor_id });

    const hookPayload = transform({ input, checked }, (data) => ({
      vendor_id: data.input.vendor_id,
      reason: data.checked.reason,
    }));
    const vendorSuspended = createHook("vendorSuspended", hookPayload);

    const auditInput = transform({ input, checked, statusChange }, (data) => ({
      event: {
        action: "vendor.suspended" as const,
        target_id: data.input.vendor_id,
        actor: {
          type: "user" as const,
          id: data.input.actor.id,
          label: data.input.actor.label,
        },
        before: { status: data.statusChange.previous_status },
        after: { status: "suspended" },
        meta: { reason: data.checked.reason },
      },
    }));
    auditVendorEventStep(auditInput);

    // A suspended vendor's later requests are refused by the vendor request
    // chain. This workflow only changes data.
    return new WorkflowResponse(
      { vendor_id: input.vendor_id, links },
      { hooks: [vendorSuspended] }
    );
  }
);
