import { PIN_PATTERN } from "./pincodes";
import {
  getStateByCode,
  toMedusaProvince,
  validatePinStatePair,
} from "./states";

export type AddressErrorCode =
  | "invalid_pin_format"
  | "invalid_province"
  | "pin_state_mismatch"
  | "invalid_phone";

export type AddressValidationResult<T extends Record<string, unknown>> =
  | { ok: true; address: T }
  | { ok: false; code: AddressErrorCode; message: string };

const MESSAGES: Record<AddressErrorCode, string> = {
  invalid_pin_format: "Enter a 6-digit PIN code that does not start with 0.",
  invalid_province: "Choose a valid state.",
  pin_state_mismatch:
    "That PIN code belongs to another state. Check the PIN and the state.",
  invalid_phone: "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.",
};

const PHONE_PATTERN = /^[6-9]\d{9}$/;
const PROVINCE_FORM = /^in-[a-z]{2,3}$/i;

function fail<T extends Record<string, unknown>>(
  code: AddressErrorCode
): AddressValidationResult<T> {
  return { ok: false, code, message: MESSAGES[code] };
}

// Blank strings and null count as absent: the storefront sends empty strings for
// fields the customer has not filled in yet, and core decides what is required.
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  return !(typeof value === "string" && value.trim() === "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reduces an Indian mobile number to its ten digits.
 * Accepts spaces, hyphens, brackets, a +91 prefix, a bare 91 prefix on twelve
 * digits and a leading 0 on eleven digits. Returns null when the result does not
 * match the mobile pattern.
 */
export function normalizePhone(value: string): string | null {
  if (typeof value !== "string") {
    return null;
  }
  let digits = value.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+91")) {
    digits = digits.slice(3);
  } else if (/^91\d{10}$/.test(digits)) {
    digits = digits.slice(2);
  } else if (/^0\d{10}$/.test(digits)) {
    digits = digits.slice(1);
  }
  return PHONE_PATTERN.test(digits) ? digits : null;
}

/**
 * Validates and normalises one address object. Never mutates the input.
 * An address in another country skips every rule here.
 */
export function validateAddressInput<T extends Record<string, unknown>>(
  input: T
): AddressValidationResult<T> {
  const address: Record<string, unknown> = { ...input };

  const country =
    typeof address.country_code === "string"
      ? address.country_code.trim().toLowerCase()
      : "";
  if (country && country !== "in") {
    return { ok: true, address: address as T };
  }

  if (isPresent(address.phone)) {
    const phone =
      typeof address.phone === "string" ? normalizePhone(address.phone) : null;
    if (phone === null) {
      return fail("invalid_phone");
    }
    address.phone = phone;
  }

  if (isPresent(address.postal_code)) {
    const pin = String(address.postal_code).trim();
    if (!PIN_PATTERN.test(pin)) {
      return fail("invalid_pin_format");
    }

    const provinceInput =
      typeof address.province === "string" ? address.province.trim() : "";
    const state = PROVINCE_FORM.test(provinceInput)
      ? getStateByCode(provinceInput)
      : undefined;
    if (!state) {
      return fail("invalid_province");
    }

    const pair = validatePinStatePair(pin, state.code);
    if (!pair.ok) {
      return fail(
        pair.reason === "pin_state_mismatch"
          ? "pin_state_mismatch"
          : pair.reason === "unknown_state"
            ? "invalid_province"
            : "invalid_pin_format"
      );
    }

    address.postal_code = pin;
    address.province = toMedusaProvince(state.code);

    const metadata = isRecord(address.metadata)
      ? { ...address.metadata }
      : undefined;
    if (pair.verified) {
      if (metadata) {
        delete metadata.pin_unverified;
        address.metadata = metadata;
      }
    } else {
      address.metadata = { ...(metadata ?? {}), pin_unverified: true };
    }
  }

  return { ok: true, address: address as T };
}
