import { NextIntlClientProvider } from "next-intl"
import { getLocale } from "next-intl/server"
import HtmlLangSync from "@modules/common/components/html-lang-sync"
import JsonLd from "@modules/common/components/json-ld"
import { buildSiteJsonLd } from "@lib/util/json-ld"

export default async function LocaleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocale()

  return (
    <NextIntlClientProvider>
      <JsonLd data={buildSiteJsonLd(locale)} />
      <HtmlLangSync />
      {children}
    </NextIntlClientProvider>
  )
}
