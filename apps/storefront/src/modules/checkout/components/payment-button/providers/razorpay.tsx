"use client"

import { RAZORPAY_PROVIDER_ID } from "@lib/constants"
import { placeOrder } from "@lib/data/cart"
import { SITE_NAME } from "@lib/util/env"
import {
  loadRazorpayCheckout,
  type RazorpayFailureResponse,
} from "@lib/util/razorpay-checkout"
import { Link, useRouter } from "@i18n/navigation"
import type { HttpTypes } from "@medusajs/types"
import { unstable_rethrow } from "next/navigation"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { PaymentButtonShell, type PaymentProviderButtonProps } from "../shared"

type RazorpaySession = {
  orderId: string
  keyId: string
  amountPaise: number
  merchantName: string | null
}

/**
 * Reads what the window needs from the cart's Razorpay payment session. The
 * key id is public by design and travels in the session data, so no
 * environment variable holds it. Returns null while the session is missing or
 * incomplete, which keeps the button disabled.
 */
const readSession = (cart: HttpTypes.StoreCart): RazorpaySession | null => {
  const session = cart.payment_collection?.payment_sessions?.find(
    (candidate) => candidate.provider_id === RAZORPAY_PROVIDER_ID
  )
  const data = (session?.data ?? {}) as Record<string, unknown>

  const orderId = data.razorpay_order_id
  const keyId = data.key_id
  const amountPaise = data.amount_paise

  if (
    typeof orderId !== "string" ||
    typeof keyId !== "string" ||
    typeof amountPaise !== "number"
  ) {
    return null
  }

  return {
    orderId,
    keyId,
    amountPaise,
    merchantName:
      typeof data.merchant_name === "string" && data.merchant_name !== ""
        ? data.merchant_name
        : null,
  }
}

const RazorpayPaymentButton = ({
  cart,
  notReady,
  label,
  cartUpdating,
  "data-testid": dataTestId,
}: PaymentProviderButtonProps) => {
  const t = useTranslations("PaymentButton")
  const tc = useTranslations("CheckoutPage")
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const session = readSession(cart)

  // The gateway has the money by the time this runs, and the server verifies
  // the payment with Razorpay itself, so the response fields are not used.
  // Completing the cart ends in a redirect. Anything else means the order is
  // not there yet (a UPI payment still settling), so the customer waits on the
  // pending page, which polls and lets the webhook finish the order.
  const finishPayment = async () => {
    try {
      await placeOrder(cart.id)
    } catch (err) {
      unstable_rethrow(err)
    }
    router.push("/checkout/pending")
  }

  const handlePay = async () => {
    if (!session) {
      return
    }

    setSubmitting(true)
    setDismissed(false)
    setErrorMessage(null)

    try {
      const Razorpay = await loadRazorpayCheckout()
      const instance = new Razorpay({
        key: session.keyId,
        order_id: session.orderId,
        amount: session.amountPaise,
        currency: "INR",
        name: session.merchantName ?? SITE_NAME,
        prefill: {
          name: [cart.billing_address?.first_name, cart.billing_address?.last_name]
            .filter(Boolean)
            .join(" "),
          email: cart.email ?? undefined,
          contact:
            cart.billing_address?.phone ??
            cart.shipping_address?.phone ??
            undefined,
        },
        handler: () => {
          void finishPayment()
        },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            setSubmitting(false)
            setDismissed(true)
          },
        },
      })

      instance.on("payment.failed", (response: RazorpayFailureResponse) => {
        setErrorMessage(response.error.description ?? t("paymentFailed"))
        setSubmitting(false)
      })

      instance.open()
    } catch {
      setErrorMessage(t("scriptLoadFailed"))
      setSubmitting(false)
    }
  }

  return (
    <>
      <PaymentButtonShell
        label={label}
        onClick={handlePay}
        disabled={notReady || !session || submitting}
        loading={submitting || cartUpdating}
        errorMessage={errorMessage}
        errorTestId="razorpay-payment-error-message"
        data-testid={dataTestId}
      />
      {dismissed && (
        <Link
          href="/checkout/pending"
          className="txt-compact-small-plus text-ui-fg-interactive underline text-center"
          data-testid="razorpay-check-status-link"
        >
          {tc("checkPaymentStatus")}
        </Link>
      )}
    </>
  )
}

export default RazorpayPaymentButton
