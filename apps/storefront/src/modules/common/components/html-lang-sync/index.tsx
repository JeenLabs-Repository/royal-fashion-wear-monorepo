"use client"

import { useLocale } from "next-intl"
import { useEffect } from "react"

const HtmlLangSync = () => {
  const locale = useLocale()

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return null
}

export default HtmlLangSync
