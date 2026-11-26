import { MedusaError } from "@medusajs/framework/utils";
import { completeCartWorkflow } from "@medusajs/medusa/core-flows";

/**
 * Free orders are unsupported: a cart whose total is zero has no Razorpay
 * payment path once the system provider is gone. Refuse completion here so a
 * zero-total cart never becomes an unpaid order.
 */
completeCartWorkflow.hooks.validate(async ({ cart }) => {
  const total = Number(cart?.total ?? NaN);
  if (Number.isFinite(total) && total <= 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "A cart with a zero total cannot be completed.",
      "zero_total_unsupported"
    );
  }
});
