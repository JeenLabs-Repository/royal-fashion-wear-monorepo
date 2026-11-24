import { MedusaError } from "@medusajs/framework/utils";

export type VendorContext = {
  id: string;
  user_id: string;
  user_email: string;
  status: "invited" | "active" | "suspended";
  internal_name: string;
};

// Handlers go through requireVendor, which does not depend on this
// augmentation. The owning declaration lives in @medusajs/types and is
// re-exported here; augmenting the package the app imports keeps tsc happy.
declare module "@medusajs/framework/http" {
  interface MedusaRequest {
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
