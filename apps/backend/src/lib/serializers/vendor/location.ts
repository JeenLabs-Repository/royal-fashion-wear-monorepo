import { getStateByCode } from "../../geo-india/states";
import { defineAllowlistSerializer } from "../define-allowlist-serializer";

// Read-only view of a location for its own vendor. The stock location id and
// the vendor id never appear.
export const vendorLocationSerializer = defineAllowlistSerializer({
  name: "vendor-location",
  audience: "vendor",
  shape: {
    id: true,
    code: true,
    label: true,
    state_code: true,
    state_name: true,
    pin: true,
    address_1: true,
    address_2: true,
    city: true,
    pickup_contact_name: true,
    pickup_contact_phone: true,
    status: true,
  },
});

/** Adds the readable state name to a stored location. */
export function toVendorLocationView<T extends { state_code: string }>(
  location: T
): T & { state_name: string | null } {
  return {
    ...location,
    state_name: getStateByCode(location.state_code)?.name ?? null,
  };
}
