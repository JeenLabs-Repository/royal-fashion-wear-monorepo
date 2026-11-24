import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { getStateByCode, validatePinStatePair } from "../../../lib/geo-india/states";
import { getVendorModule } from "../../../lib/vendor/vendor-module";

export type LocationFields = {
  label: string;
  state_code: string;
  pin: string;
  address_1: string;
  address_2?: string | null;
  city?: string | null;
  pickup_contact_name: string;
  pickup_contact_phone: string;
  status: "active" | "inactive";
};

export type RawLocationInput = Partial<Record<keyof LocationFields, unknown>>;

const FIELD_CODE = "invalid_location_field";

const fieldError = (message: string) =>
  new MedusaError(MedusaError.Types.INVALID_DATA, message, FIELD_CODE);

const requiredText = (value: unknown, name: string, max: number): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 1 || text.length > max) {
    throw fieldError(`${name} must be 1 to ${max} characters.`);
  }
  return text;
};

const optionalText = (value: unknown, name: string, max: number): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max) {
    throw fieldError(`${name} must be at most ${max} characters.`);
  }
  return text.length > 0 ? text : null;
};

const PHONE_PATTERN = /^\+?[0-9]{8,13}$/;

/**
 * Checks and tidies the fields of a location. The state is returned in its
 * canonical ISO form, the phone without spaces and hyphens. Throws before
 * anything is created, so a rejected input leaves no trace.
 */
export function normalizeLocationInput(raw: RawLocationInput): LocationFields {
  const pin = typeof raw.pin === "string" ? raw.pin.trim() : "";
  const stateInput = typeof raw.state_code === "string" ? raw.state_code.trim() : "";
  const pair = validatePinStatePair(pin, stateInput);
  const state = getStateByCode(stateInput);
  if (!pair.ok || !state) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PIN code or state is not valid.",
      "invalid_pin_state"
    );
  }

  const label = requiredText(raw.label, "Label", 60);
  const address1 = requiredText(raw.address_1, "Address line 1", 120);
  const address2 = optionalText(raw.address_2, "Address line 2", 120);
  const city = optionalText(raw.city, "City", 120);
  const contactName = requiredText(raw.pickup_contact_name, "Pickup contact name", 80);

  const phone =
    typeof raw.pickup_contact_phone === "string"
      ? raw.pickup_contact_phone.replace(/[\s-]/g, "")
      : "";
  if (!PHONE_PATTERN.test(phone)) {
    throw fieldError("Pickup contact phone must be 8 to 13 digits with an optional leading plus.");
  }

  const status = raw.status === undefined ? "active" : raw.status;
  if (status !== "active" && status !== "inactive") {
    throw fieldError("Status must be active or inactive.");
  }

  return {
    label,
    state_code: state.code,
    pin,
    address_1: address1,
    address_2: address2,
    city,
    pickup_contact_name: contactName,
    pickup_contact_phone: phone,
    status,
  };
}

export const validateLocationInputStep = createStep(
  "validate-location-input",
  async (input: { raw: RawLocationInput }) =>
    new StepResponse(normalizeLocationInput(input.raw))
);

type LoadForUpdateInput = {
  vendor_id: string;
  location_id: string;
  patch: Partial<LocationFields>;
};

const pick = <K extends keyof LocationFields>(
  patch: Partial<LocationFields>,
  key: K,
  current: LocationFields[K]
): LocationFields[K] => (patch[key] !== undefined ? (patch[key] as LocationFields[K]) : current);

/**
 * Loads the location the vendor owns (a foreign or missing one is "not found"
 * with no hint which) and returns the values the update would produce, plus a
 * short before snapshot for the audit entry. It lives with the other input
 * steps so the update step itself stays a plain write.
 */
export const loadLocationForUpdateStep = createStep(
  "load-location-for-update",
  async (input: LoadForUpdateInput, { container }) => {
    const [location] = await getVendorModule(container).listVendorLocations(
      { id: input.location_id, vendor_id: input.vendor_id },
      { take: 1 }
    );
    if (!location) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
    }
    const merged: LocationFields = {
      label: pick(input.patch, "label", location.label),
      state_code: pick(input.patch, "state_code", location.state_code),
      pin: pick(input.patch, "pin", location.pin),
      address_1: pick(input.patch, "address_1", location.address_1),
      address_2: pick(input.patch, "address_2", location.address_2 ?? null),
      city: pick(input.patch, "city", location.city ?? null),
      pickup_contact_name: pick(
        input.patch,
        "pickup_contact_name",
        location.pickup_contact_name
      ),
      pickup_contact_phone: pick(
        input.patch,
        "pickup_contact_phone",
        location.pickup_contact_phone
      ),
      status: pick(input.patch, "status", location.status as LocationFields["status"]),
    };
    const before = {
      location: location.code,
      state_code: location.state_code,
      pin: location.pin,
      status: location.status,
    };
    return new StepResponse({ merged, before });
  }
);
