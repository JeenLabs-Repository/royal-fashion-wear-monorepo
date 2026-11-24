import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { auditVendorEventStep } from "../../lib/vendor/audit";
import { reconcileChannelLinksStep } from "./steps/reconcile-channel-links";
import { updateLocationRecordStep } from "./steps/update-location-record";
import {
  loadLocationForUpdateStep,
  validateLocationInputStep,
  type LocationFields,
} from "./steps/validate-location-input";
import { vendorLocationValidationWorkflow } from "./validate-vendor-location";

export type UpdateVendorLocationInput = {
  vendor_id: string;
  location_id: string;
  patch: Partial<LocationFields>;
  actor: { id: string; label?: string };
};

export const updateVendorLocationWorkflow = createWorkflow(
  "update-vendor-location",
  function (input: UpdateVendorLocationInput) {
    const loaded = loadLocationForUpdateStep({
      vendor_id: input.vendor_id,
      location_id: input.location_id,
      patch: input.patch,
    });

    const rawInput = transform({ loaded }, (data) => ({ raw: data.loaded.merged }));
    const fields = validateLocationInputStep(rawInput);

    const validationInput = transform({ input, fields }, (data) => ({
      vendor_id: data.input.vendor_id,
      operation: "update" as const,
      location_id: data.input.location_id,
      proposed: data.fields,
    }));
    vendorLocationValidationWorkflow.runAsStep({ input: validationInput });

    const updateInput = transform({ input, fields }, (data) => ({
      vendor_id: data.input.vendor_id,
      location_id: data.input.location_id,
      fields: data.fields,
    }));
    const record = updateLocationRecordStep(updateInput);

    reconcileChannelLinksStep({ vendor_id: input.vendor_id });

    const auditInput = transform({ input, loaded, fields }, (data) => ({
      event: {
        action: "vendor.location_updated" as const,
        target_id: data.input.vendor_id,
        actor: {
          type: "user" as const,
          id: data.input.actor.id,
          label: data.input.actor.label,
        },
        before: data.loaded.before,
        after: {
          location: data.loaded.before.location,
          state_code: data.fields.state_code,
          pin: data.fields.pin,
          status: data.fields.status,
        },
        meta: { location_id: data.input.location_id },
      },
    }));
    auditVendorEventStep(auditInput);

    return new WorkflowResponse(record);
  }
);
