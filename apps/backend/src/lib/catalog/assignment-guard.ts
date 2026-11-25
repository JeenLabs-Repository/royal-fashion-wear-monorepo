/**
 * True when an order line for this variant is currently assigned to a vendor
 * location. The order routing work supplies the real check behind this same
 * signature. Variant removal must call it together with a stock and
 * reservation check.
 */
export async function variantHasOpenAssignment(_variantId: string): Promise<boolean> {
  return false;
}
