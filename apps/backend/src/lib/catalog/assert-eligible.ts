import type { MedusaContainer } from "@medusajs/framework/types";
import { assertVendorEligible } from "../vendor/eligibility";
import { catalogError } from "./errors";

/**
 * Passes only for an active vendor with the current agreement. The catalog error code is
 * `vendor_not_eligible`; the decision routes answer it with 409, the vendor routes with 403.
 */
export async function assertEligible(container: MedusaContainer, vendorId: string): Promise<void> {
  try {
    await assertVendorEligible(container, vendorId);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "vendor_ineligible") {
      throw catalogError("vendor_not_eligible", "This vendor is not eligible to list products.");
    }
    throw error;
  }
}
