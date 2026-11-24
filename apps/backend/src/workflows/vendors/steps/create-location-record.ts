import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { getVendorModule } from "../../../lib/vendor/vendor-module";
import type { LocationFields } from "./validate-location-input";

export type CreateLocationRecordInput = {
  vendor_id: string;
  code: string;
  stock_location_id: string;
  fields: LocationFields;
};

export const createLocationRecordStep = createStep(
  "create-location-record",
  async (input: CreateLocationRecordInput, { container }) => {
    const [row] = await getVendorModule(container).createVendorLocations([
      {
        vendor_id: input.vendor_id,
        code: input.code,
        stock_location_id: input.stock_location_id,
        label: input.fields.label,
        state_code: input.fields.state_code,
        pin: input.fields.pin,
        address_1: input.fields.address_1,
        address_2: input.fields.address_2 ?? null,
        city: input.fields.city ?? null,
        pickup_contact_name: input.fields.pickup_contact_name,
        pickup_contact_phone: input.fields.pickup_contact_phone,
        status: input.fields.status,
      },
    ]);
    return new StepResponse(
      { id: row.id, code: row.code, stock_location_id: row.stock_location_id },
      { id: row.id }
    );
  },
  async (compensation, { container }) => {
    if (!compensation?.id) {
      return;
    }
    await getVendorModule(container).deleteVendorLocations([compensation.id]);
  }
);
