import { MedusaError } from "@medusajs/framework/utils";

/**
 * Passes when the resource belongs to the vendor. A missing resource and a
 * resource of another vendor throw the identical "not found" error, so a
 * caller can never learn that someone else's resource exists.
 */
export function assertOwns<T extends Record<string, unknown>>(
  vendorId: string,
  resource: T | null | undefined,
  options: { ownerField?: string } = {}
): asserts resource is T {
  const field = options.ownerField ?? "vendor_id";
  if (!resource || resource[field] !== vendorId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
  }
}
