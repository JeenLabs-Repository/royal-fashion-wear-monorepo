import { MedusaError } from "@medusajs/framework/utils";

export type VendorContext = {
  id: string;
  user_id: string;
  user_email: string;
  status: "invited" | "active" | "suspended";
  internal_name: string;
};

// MedusaRequest is declared in @medusajs/types and re-exported from
// @medusajs/framework/http, so the augmentation must target the owning module.
declare module "@medusajs/types" {
  interface MedusaRequest<Body = unknown, QueryFields = Record<string, unknown>> {
    vendor?: VendorContext;
  }
}

/** The vendor the guard attached to this request. */
export function requireVendor(req: object): VendorContext {
  const vendor = (req as { vendor?: VendorContext }).vendor;
  if (!vendor) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized");
  }
  return vendor;
}
