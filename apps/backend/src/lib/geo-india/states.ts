import { MedusaError } from "@medusajs/framework/utils";
import statesData from "./states-data.json";
import { PIN_PATTERN, lookupPin } from "./pincodes";

export type IndianState = {
  /** ISO 3166-2:IN code, for example IN-MH */
  code: string;
  name: string;
  /** Two-digit GST state code */
  gst_code: string;
  /** Which half of the tax an intra-state sale carries next to the central tax */
  gst_head: "SGST" | "UTGST";
};

// The 36 states and union territories, sorted by ISO code. Delhi, Puducherry
// and Jammu and Kashmir have legislatures and stay on the state head. The old
// GST codes 25 and 28 no longer exist and are not listed.
export const STATES: readonly IndianState[] = statesData as readonly IndianState[];

const BY_CODE = new Map(STATES.map((state) => [state.code, state]));
const BY_GST_CODE = new Map(STATES.map((state) => [state.gst_code, state]));

/** Accepts `IN-MH`, `in-mh` and `MH`. */
export function getStateByCode(input: string): IndianState | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const upper = input.trim().toUpperCase();
  const full = upper.startsWith("IN-") ? upper : `IN-${upper}`;
  return BY_CODE.get(full);
}

/** Accepts `27` and `7` (padded to two digits). */
export function getStateByGstCode(gst: string): IndianState | undefined {
  if (typeof gst !== "string") {
    return undefined;
  }
  return BY_GST_CODE.get(gst.trim().padStart(2, "0"));
}

/** The lowercase ISO form Medusa stores in an address province, for example `in-mh`. */
export function toMedusaProvince(code: string): string {
  const state = getStateByCode(code);
  if (!state) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Unknown state code."
    );
  }
  return state.code.toLowerCase();
}

export type PinStateResult =
  | { ok: true; verified: boolean }
  | {
      ok: false;
      reason: "invalid_pin_format" | "unknown_state" | "pin_state_mismatch";
      expected_state?: string;
    };

/**
 * Checks a PIN and a state against the bundled directory.
 * A known PIN with another state is a mismatch. An unknown but well-formed PIN
 * passes with verified false, so a stale directory never blocks a sale.
 */
export function validatePinStatePair(
  pin: string,
  stateCode: string
): PinStateResult {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return { ok: false, reason: "invalid_pin_format" };
  }
  const state = getStateByCode(stateCode);
  if (!state) {
    return { ok: false, reason: "unknown_state" };
  }
  const entry = lookupPin(pin);
  if (!entry) {
    return { ok: true, verified: false };
  }
  if (entry.state_code.toUpperCase() !== state.code.toUpperCase()) {
    return {
      ok: false,
      reason: "pin_state_mismatch",
      expected_state: entry.state_code,
    };
  }
  return { ok: true, verified: true };
}
