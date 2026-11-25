"use client"

import { Link } from "@i18n/navigation"
import { placeOrder } from "@lib/data/cart"
import { Spinner } from "@medusajs/icons"
import { unstable_rethrow } from "next/navigation"
import { useTranslations } from "next-intl"
import { useCallback, useEffect, useRef, useState } from "react"

const POLL_INTERVAL_MS = 3000
const POLL_WINDOW_MS = 300000
const STILL_WAITING_AFTER_MS = 60000

type PaymentPendingProps = {
  cartId: string
}

type Phase = "waiting" | "slow" | "timeout"

/**
 * Asks the server to complete the cart every few seconds until it becomes an
 * order. Completion ends in a framework redirect to the confirmation page.
 * A cart that is not complete yet returns normally or throws, and both mean
 * keep waiting. The webhook completes the order on its own, so this page only
 * speeds up what the customer sees.
 */
const PaymentPending = ({ cartId }: PaymentPendingProps) => {
  const t = useTranslations("PaymentPending")
  const [phase, setPhase] = useState<Phase>("waiting")
  const running = useRef(false)
  const stopped = useRef(false)

  const poll = useCallback(async () => {
    // One request at a time, none while the tab is hidden, none after the end.
    if (running.current || stopped.current) {
      return
    }
    if (document.visibilityState === "hidden") {
      return
    }

    running.current = true
    try {
      await placeOrder(cartId)
    } catch (err) {
      unstable_rethrow(err)
    } finally {
      running.current = false
    }
  }, [cartId])

  useEffect(() => {
    const startedAt = Date.now()
    stopped.current = false

    const stop = (timer?: ReturnType<typeof setInterval>) => {
      stopped.current = true
      if (timer) {
        clearInterval(timer)
      }
    }

    const tick = () => {
      const elapsed = Date.now() - startedAt

      if (elapsed >= POLL_WINDOW_MS) {
        // One last attempt, then give up and say what happens next.
        void poll()
        stop(timer)
        setPhase("timeout")
        return
      }

      if (elapsed >= STILL_WAITING_AFTER_MS) {
        setPhase("slow")
      }
      void poll()
    }

    // A UPI app hands the customer back to this tab, so ask again at once.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void poll()
      }
    }

    const timer = setInterval(tick, POLL_INTERVAL_MS)
    document.addEventListener("visibilitychange", onVisible)
    void poll()

    return () => {
      stop(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [poll])

  return (
    <div
      className="content-container flex flex-col items-center gap-y-4 py-16 text-center"
      data-testid="payment-pending"
    >
      {phase !== "timeout" && <Spinner className="animate-spin" />}
      <h1 className="h2-docs">{t("heading")}</h1>
      <p className="txt-medium text-ui-fg-subtle max-w-md">
        {phase === "timeout" ? t("timeout") : t("body")}
      </p>
      <p
        role="status"
        aria-live="polite"
        className="txt-compact-small text-ui-fg-muted min-h-5"
      >
        {phase === "slow" ? t("stillWaiting") : null}
      </p>
      {phase === "timeout" && (
        <Link
          href="/checkout"
          className="txt-compact-small-plus text-ui-fg-interactive underline"
        >
          {t("backToCheckout")}
        </Link>
      )}
    </div>
  )
}

export default PaymentPending
