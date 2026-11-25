import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { lookupPin, PIN_PATTERN } from "../../../../../lib/geo-india/pincodes";

const PinParam = z.string().regex(PIN_PATTERN);

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
  const parsed = PinParam.safeParse(req.params.pin);
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The PIN must be six digits and not start with 0."
    );
  }
  const hit = lookupPin(parsed.data);
  if (!hit) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "No such PIN in the directory.");
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.json({
    pin: parsed.data,
    state_code: hit.state_code,
    district: hit.district,
    city: hit.city,
    localities: hit.localities,
  });
}
