import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { lookupPin } from "../../../../../lib/geo-india/pincodes";

// Keep the pattern local. Passing an imported RegExp into zod's .regex() throws
// `Cannot set properties of undefined (setting 'lastIndex')` under Medusa's
// develop loader (zod 4).
const PIN_RE = /^[1-9][0-9]{5}$/;

// Public static data: one explicit shape, no vendor, store or customer field can enter it.
type PincodeBody = {
  pin: string;
  state_code: string;
  district: string;
  city: string;
  localities: string[];
};

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse<PincodeBody>
): Promise<void> {
  const pin = typeof req.params.pin === "string" ? req.params.pin : "";
  if (!PIN_RE.test(pin)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The PIN must be six digits and not start with 0."
    );
  }
  const hit = lookupPin(pin);
  if (!hit) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "No such PIN in the directory.");
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.json({
    pin,
    state_code: hit.state_code,
    district: hit.district,
    city: hit.city,
    localities: hit.localities,
  });
}
