import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { allocateLocationCodeStep } from "./steps/allocate-location-code";
import { auditVendorEventStep } from "../../lib/vendor/audit";
import { createCoreStockLocationStep } from "./steps/create-core-stock-location";
import { createLocationRecordStep } from "./steps/create-location-record";
import { reconcileChannelLinksStep } from "./steps/reconcile-channel-links";
import { validateLocationInputStep } from "./steps/validate-location-input";
import { vendorLocationValidationWorkflow } from "./validate-vendor-location";

export type CreateVendorLocationInput = {
  vendor_id: string;
  label: string;
  state_code: string;
  pin: string;
  address_1: string;
  address_2?: string | null;
  city?: string | null;
  pickup_contact_name: string;
  pickup_contact_phone: string;
  status?: "active" | "inactive";
  actor: { id: string; label?: string };
};

export const createVendorLocationWorkflow = createWorkflow(
  "create-vendor-location",
  function (input: CreateVendorLocationInput) {
    // Nothing is created, and no code is used up, until this has passed.
    const fields = validateLocationInputStep({ raw: input });

    const validationInput = transform({ input, fields }, (data) => ({
      vendor_id: data.input.vendor_id,
      operation: "create" as const,
      proposed: data.fields,
    }));
    vendorLocationValidationWorkflow.runAsStep({ input: validationInput });

    const code = allocateLocationCodeStep();

    const stockInput = transform({ code, fields }, (data) => ({
      code: data.code,
      state_code: data.fields.state_code,
    }));
    const stockLocation = createCoreStockLocationStep(stockInput);

    const recordInput = transform({ input, code, stockLocation, fields }, (data) => ({
      vendor_id: data.input.vendor_id,
      code: data.code,
      stock_location_id: data.stockLocation.id,
      fields: data.fields,
    }));
    const record = createLocationRecordStep(recordInput);

    // Runs after the row exists, because it reads the row to decide the link.
    reconcileChannelLinksStep({ vendor_id: input.vendor_id });

    const auditInput = transform({ input, record, fields }, (data) => ({
      event: {
        action: "vendor.location_created" as const,
        target_id: data.input.vendor_id,
        actor: {
          type: "user" as const,
          id: data.input.actor.id,
          label: data.input.actor.label,
        },
        after: {
          location: data.record.code,
          state_code: data.fields.state_code,
          pin: data.fields.pin,
          status: data.fields.status,
        },
        meta: { location_id: data.record.id },
      },
    }));
    auditVendorEventStep(auditInput);

    return new WorkflowResponse(record);
  }
);
