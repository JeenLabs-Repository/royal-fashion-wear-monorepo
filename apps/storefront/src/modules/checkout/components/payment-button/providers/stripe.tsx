"use client"

import {
  PaymentButtonShell,
  type PaymentProviderButtonProps,
} from "../shared"

/**
 * Card Elements and the redirect return route are gone. This stub keeps the
 * dispatch compiling until the remaining provider cleanup removes the branch.
 */
const StripePaymentButton = (props: PaymentProviderButtonProps) => {
  return (
    <PaymentButtonShell
      label={props.label}
      onClick={() => {}}
      disabled
      loading={props.cartUpdating}
      errorMessage={null}
      errorTestId="stripe-payment-error-message"
      data-testid={props["data-testid"]}
    />
  )
}

export default StripePaymentButton
