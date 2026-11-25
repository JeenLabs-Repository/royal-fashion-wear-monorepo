import { Text } from "@medusajs/ui"
import { getTranslations } from "next-intl/server"

import { getShipFrom } from "@lib/data/ship-from"
import { buildShipFromText } from "@lib/util/ship-from-text"

/**
 * One small line under the product info: the state the product ships from.
 * It renders nothing when no state is known or the lookup failed.
 */
export default async function ShipFromLine({
  productId,
}: {
  productId: string
}) {
  const [t, byProduct] = await Promise.all([
    getTranslations("ProductPage"),
    getShipFrom([productId]),
  ])

  const text = buildShipFromText(byProduct[productId] ?? [], {
    shipFrom: (states) => t("shipFrom", { states }),
    multiple: t("shipFromMultiple"),
    and: t("listAnd"),
  })

  if (!text) {
    return null
  }

  return (
    <Text
      className="txt-compact-small text-ui-fg-subtle"
      data-testid="ship-from-line"
    >
      {text}
    </Text>
  )
}
