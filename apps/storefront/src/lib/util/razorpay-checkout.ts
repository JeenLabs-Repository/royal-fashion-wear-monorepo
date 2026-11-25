/**
 * Loads the payment window script on demand. This file is the only place that
 * holds the script address, and only modules under `modules/checkout/` may
 * import it, so the script never runs on a page that has no payment step.
 */

export type RazorpayHandlerResponse = {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

export type RazorpayFailureResponse = {
  error: {
    code?: string
    description?: string
    reason?: string
  }
}

export type RazorpayOptions = {
  key: string
  order_id: string
  /** Integer paise, as the payment session data carries it. */
  amount: number
  currency: "INR"
  name: string
  prefill?: {
    name?: string
    email?: string
    contact?: string
  }
  handler: (response: RazorpayHandlerResponse) => void
  modal?: {
    confirm_close?: boolean
    ondismiss?: () => void
  }
}

export type RazorpayInstance = {
  open: () => void
  on: (
    event: "payment.failed",
    listener: (response: RazorpayFailureResponse) => void
  ) => void
}

export type RazorpayConstructor = new (
  options: RazorpayOptions
) => RazorpayInstance

declare global {
  // Declaration merging needs an interface; the script adds this one field.
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js"
const LOAD_TIMEOUT_MS = 15000

let pending: Promise<RazorpayConstructor> | null = null

/**
 * Appends the script once and resolves with the constructor. A failed load
 * clears the cache so the next click tries again.
 */
export function loadRazorpayCheckout(): Promise<RazorpayConstructor> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("The payment window needs a browser"))
  }

  if (typeof window.Razorpay === "function") {
    return Promise.resolve(window.Razorpay)
  }

  if (pending) {
    return pending
  }

  pending = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = SCRIPT_URL
    script.async = true

    const fail = (message: string) => {
      window.clearTimeout(timer)
      script.remove()
      pending = null
      reject(new Error(message))
    }

    const timer = window.setTimeout(
      () => fail("The payment window took too long to load"),
      LOAD_TIMEOUT_MS
    )

    script.onload = () => {
      window.clearTimeout(timer)
      if (typeof window.Razorpay === "function") {
        resolve(window.Razorpay)
        return
      }
      fail("The payment window did not start")
    }
    script.onerror = () => fail("The payment window could not be loaded")

    document.head.appendChild(script)
  })

  return pending
}
