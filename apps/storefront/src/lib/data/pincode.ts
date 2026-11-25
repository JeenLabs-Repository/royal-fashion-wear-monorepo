"use server"

import { fetchWithoutLocale } from "@lib/config"
import { PIN_PATTERN, provinceFromStateCode } from "@lib/util/india-states"

export type PincodeLookup =
  | {
      found: true
      state_code: string
      province: string
      district: string
      city: string
      localities: string[]
    }
  | { found: false }

type PincodeResponse = {
  pin: string
  state_code: string
  district?: string
  city?: string
  localities?: string[]
}

/**
 * Looks a PIN up through the store's own backend route. The route reads a
 * bundled dataset, so no outside service and no key are involved. The request
 * carries no credentials and its answer is the same for everyone, which is why
 * it may be cached for a day. Any failure, including a 404 for a PIN the
 * dataset does not know, answers `{ found: false }` and never throws.
 *
 * @param pin - six digits typed by the customer
 */
export async function lookupPincode(pin: string): Promise<PincodeLookup> {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return { found: false }
  }

  try {
    const body = await fetchWithoutLocale<PincodeResponse>(
      `/store/india/pincodes/${pin}`,
      { method: "GET", next: { revalidate: 86400 } }
    )

    if (!body || typeof body.state_code !== "string") {
      return { found: false }
    }

    return {
      found: true,
      state_code: body.state_code,
      province: provinceFromStateCode(body.state_code),
      district: body.district ?? "",
      city: body.city ?? "",
      localities: Array.isArray(body.localities) ? body.localities : [],
    }
  } catch {
    return { found: false }
  }
}
