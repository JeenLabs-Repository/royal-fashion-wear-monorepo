import { MedusaError } from "@medusajs/framework/utils";

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
export const STATES: readonly IndianState[] = [
  { code: "IN-AN", name: "Andaman and Nicobar Islands", gst_code: "35", gst_head: "UTGST" },
  { code: "IN-AP", name: "Andhra Pradesh", gst_code: "37", gst_head: "SGST" },
  { code: "IN-AR", name: "Arunachal Pradesh", gst_code: "12", gst_head: "SGST" },
  { code: "IN-AS", name: "Assam", gst_code: "18", gst_head: "SGST" },
  { code: "IN-BR", name: "Bihar", gst_code: "10", gst_head: "SGST" },
  { code: "IN-CH", name: "Chandigarh", gst_code: "04", gst_head: "UTGST" },
  { code: "IN-CT", name: "Chhattisgarh", gst_code: "22", gst_head: "SGST" },
  // ISO 3166-2:IN is IN-DH; Medusa dashboard still lists the older IN-DN alias.
  { code: "IN-DH", name: "Dadra and Nagar Haveli and Daman and Diu", gst_code: "26", gst_head: "UTGST" },
  { code: "IN-DL", name: "Delhi", gst_code: "07", gst_head: "SGST" },
  { code: "IN-GA", name: "Goa", gst_code: "30", gst_head: "SGST" },
  { code: "IN-GJ", name: "Gujarat", gst_code: "24", gst_head: "SGST" },
  { code: "IN-HP", name: "Himachal Pradesh", gst_code: "02", gst_head: "SGST" },
  { code: "IN-HR", name: "Haryana", gst_code: "06", gst_head: "SGST" },
  { code: "IN-JH", name: "Jharkhand", gst_code: "20", gst_head: "SGST" },
  { code: "IN-JK", name: "Jammu and Kashmir", gst_code: "01", gst_head: "SGST" },
  { code: "IN-KA", name: "Karnataka", gst_code: "29", gst_head: "SGST" },
  { code: "IN-KL", name: "Kerala", gst_code: "32", gst_head: "SGST" },
  { code: "IN-LA", name: "Ladakh", gst_code: "38", gst_head: "UTGST" },
  { code: "IN-LD", name: "Lakshadweep", gst_code: "31", gst_head: "UTGST" },
  { code: "IN-MH", name: "Maharashtra", gst_code: "27", gst_head: "SGST" },
  { code: "IN-ML", name: "Meghalaya", gst_code: "17", gst_head: "SGST" },
  { code: "IN-MN", name: "Manipur", gst_code: "14", gst_head: "SGST" },
  { code: "IN-MP", name: "Madhya Pradesh", gst_code: "23", gst_head: "SGST" },
  { code: "IN-MZ", name: "Mizoram", gst_code: "15", gst_head: "SGST" },
  { code: "IN-NL", name: "Nagaland", gst_code: "13", gst_head: "SGST" },
  // ISO 3166-2:IN is IN-OD; Medusa dashboard still lists the older IN-OR alias.
  { code: "IN-OD", name: "Odisha", gst_code: "21", gst_head: "SGST" },
  { code: "IN-PB", name: "Punjab", gst_code: "03", gst_head: "SGST" },
  { code: "IN-PY", name: "Puducherry", gst_code: "34", gst_head: "SGST" },
  { code: "IN-RJ", name: "Rajasthan", gst_code: "08", gst_head: "SGST" },
  { code: "IN-SK", name: "Sikkim", gst_code: "11", gst_head: "SGST" },
  { code: "IN-TG", name: "Telangana", gst_code: "36", gst_head: "SGST" },
  { code: "IN-TN", name: "Tamil Nadu", gst_code: "33", gst_head: "SGST" },
  { code: "IN-TR", name: "Tripura", gst_code: "16", gst_head: "SGST" },
  { code: "IN-UP", name: "Uttar Pradesh", gst_code: "09", gst_head: "SGST" },
  { code: "IN-UT", name: "Uttarakhand", gst_code: "05", gst_head: "SGST" },
  { code: "IN-WB", name: "West Bengal", gst_code: "19", gst_head: "SGST" },
];

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
  | { ok: true }
  | { ok: false; reason: "invalid_pin_format" | "unknown_state" };

const PIN_PATTERN = /^[1-9][0-9]{5}$/;

// The signature is stable on purpose: a later change replaces only this body
// to consult a bundled PIN directory.
export function validatePinStatePair(
  pin: string,
  stateCode: string
): PinStateResult {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return { ok: false, reason: "invalid_pin_format" };
  }
  if (!getStateByCode(stateCode)) {
    return { ok: false, reason: "unknown_state" };
  }
  return { ok: true };
}
