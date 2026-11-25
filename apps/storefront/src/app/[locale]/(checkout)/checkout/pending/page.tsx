import { redirect } from "@i18n/navigation"
import { getCartId } from "@lib/data/cookies"
import { pageTitle } from "@lib/util/page-title"
import PaymentPending from "@modules/checkout/components/payment-pending"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

// The cart cookie decides what this page does, so it is never prerendered.
export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PaymentPending")

  return {
    title: pageTitle(t("heading")),
  }
}

export default async function PaymentPendingPage() {
  const cartId = await getCartId()

  if (!cartId) {
    const locale = await getLocale()
    return redirect({ href: "/cart", locale })
  }

  return <PaymentPending cartId={cartId} />
}
