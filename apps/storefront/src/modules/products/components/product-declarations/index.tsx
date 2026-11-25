import { Heading } from "@medusajs/ui"
import { getTranslations } from "next-intl/server"

import { getProductDeclarations } from "@lib/data/product-declarations"

/**
 * A labelled list of the declaration lines the server allows. In the default
 * display mode the route answers with no lines and this component renders no
 * element at all.
 */
export default async function ProductDeclarations({
  productId,
}: {
  productId: string
}) {
  const byProduct = await getProductDeclarations([productId])
  const lines = byProduct[productId] ?? []

  if (lines.length === 0) {
    return null
  }

  const t = await getTranslations("ProductPage")

  return (
    <section
      className="flex flex-col gap-y-2"
      data-testid="product-declarations"
    >
      <Heading level="h3" className="txt-compact-medium-plus text-ui-fg-base">
        {t("declarationsHeading")}
      </Heading>
      <dl className="txt-compact-small flex flex-col gap-y-1 text-ui-fg-subtle">
        {lines.map((line) => (
          <div key={`${line.label}:${line.value}`} className="flex gap-x-2">
            <dt className="shrink-0 text-ui-fg-muted">{line.label}</dt>
            <dd className="text-ui-fg-base">{line.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
