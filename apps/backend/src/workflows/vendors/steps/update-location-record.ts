import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { getVendorModule } from "../../../lib/vendor/vendor-module";
import { setStockLocationProvince } from "./create-core-stock-location";
import type { LocationFields } from "./validate-location-input";

// The reference of a location is chosen once and never edited, so it is not on
// this list.
const PATCHABLE = [
  "label",
  "state_code",
  "pin",
  "address_1",
  "address_2",
  "city",
  "pickup_contact_name",
  "pickup_contact_phone",
  "status",
] as const;

export type UpdateLocationRecordInput = {
  vendor_id: string;
  location_id: string;
  fields: LocationFields;
};

export const updateLocationRecordStep = createStep(
  "update-location-record",
  async (input: UpdateLocationRecordInput, { container }) => {
    const vendorModule = getVendorModule(container);
    const [location] = await vendorModule.listVendorLocations(
      { id: input.location_id, vendor_id: input.vendor_id },
      { take: 1 }
    );
    if (!location) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
    }

    const previous: Record<string, unknown> = {};
    const patch: Record<string, unknown> = { id: location.id };
    for (const field of PATCHABLE) {
      previous[field] = (location as Record<string, unknown>)[field] ?? null;
      patch[field] = input.fields[field] ?? null;
    }
    await vendorModule.updateVendorLocations([patch] as never);

    const stateChanged = location.state_code !== input.fields.state_code;
    if (stateChanged && location.stock_location_id) {
      await setStockLocationProvince(
        container,
        location.stock_location_id,
        input.fields.state_code
      );
    }

    return new StepResponse(
      { id: location.id },
      {
        id: location.id,
        previous,
        stock_location_id: location.stock_location_id ?? null,
        restore_province: stateChanged,
      }
    );
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return;
    }
    await getVendorModule(container).updateVendorLocations([
      { id: compensation.id, ...compensation.previous },
    ] as never);
    if (compensation.restore_province && compensation.stock_location_id) {
      await setStockLocationProvince(
        container,
        compensation.stock_location_id,
        String(compensation.previous.state_code)
      );
    }
  }
);
