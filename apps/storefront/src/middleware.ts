import { isAppLocale, defaultLocale, matchBrowserLocale } from "@i18n/config"
import { COOKIE_NAMES, persistentCookieOpts } from "@lib/cookie-config"
import { DEFAULT_REGION } from "@lib/util/env"
import type { HttpTypes } from "@medusajs/types"
import { type NextRequest, NextResponse } from "next/server"

// Server-only address first, so a container can reach the backend by its internal
// name while the browser keeps the public address in NEXT_PUBLIC_MEDUSA_BACKEND_URL.
const BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
const PUBLISHABLE_API_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

const INTL_LOCALE_HEADER = "X-NEXT-INTL-LOCALE"

type RegionMap = Map<string, HttpTypes.StoreRegion>

const COUNTRY_MAX_AGE = 60 * 60 * 24 * 365
const FALLBACK_COUNTRY_MAX_AGE = 60 * 5

const regionMapCache = {
  regionMap: new Map<string, HttpTypes.StoreRegion>(),
  regionMapUpdated: Date.now(),
}

async function getRegionMap(cacheId: string) {
  const { regionMap, regionMapUpdated } = regionMapCache

  if (!BACKEND_URL) {
    throw new Error(
      "Middleware.ts: Error fetching regions. Did you set up regions in your Medusa Admin and define a MEDUSA_BACKEND_URL or NEXT_PUBLIC_MEDUSA_BACKEND_URL environment variable."
    )
  }

  if (
    !regionMap.keys().next().value ||
    regionMapUpdated < Date.now() - 3600 * 1000
  ) {
    const response = await fetch(`${BACKEND_URL}/store/regions?limit=1000`, {
      method: "GET",
      headers: {
        "x-publishable-api-key": PUBLISHABLE_API_KEY!,
      },
      next: {
        revalidate: 3600,
        tags: [`regions-${cacheId}`],
      },
      cache: "force-cache",
    })

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`)
    }

    const { regions } = await response.json()

    if (!regions?.length) {
      return new Map<string, HttpTypes.StoreRegion>()
    }

    regions.forEach((region: HttpTypes.StoreRegion) => {
      region.countries?.forEach((c) => {
        regionMapCache.regionMap.set(c.iso_2 ?? "", region)
      })
    })

    regionMapCache.regionMapUpdated = Date.now()
  }

  return regionMapCache.regionMap
}

/**
 * Chooses the country for a visitor without any outside lookup: the existing
 * country cookie when it names a known region, otherwise the default region.
 * Returns a function that writes the cookie onto the response.
 */
function resolveCountryCookie(
  request: NextRequest,
  regionMap: RegionMap
): (res: NextResponse) => NextResponse {
  const existing = request.cookies.get(COOKIE_NAMES.country)?.value

  let countryCode = DEFAULT_REGION
  let settled = true

  if (existing && regionMap.has(existing)) {
    countryCode = existing
  } else if (!regionMap.has(DEFAULT_REGION)) {
    // The default region is not configured in the backend: use the first
    // region there is, and keep the cookie short-lived so it is chosen again.
    countryCode = regionMap.keys().next().value ?? DEFAULT_REGION
    settled = false
  }

  return (res) => {
    res.cookies.set(COOKIE_NAMES.country, countryCode, {
      ...persistentCookieOpts,
      maxAge: settled ? COUNTRY_MAX_AGE : FALLBACK_COUNTRY_MAX_AGE,
    })
    return res
  }
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.includes(".")) {
    return NextResponse.next()
  }

  const cacheIdCookie = request.cookies.get(COOKIE_NAMES.cacheId)
  const cacheId = cacheIdCookie?.value || crypto.randomUUID()
  const regionMap: RegionMap = await getRegionMap(cacheId)

  // The country comes from the _medusa_country cookie or the default region;
  // nothing about the visitor leaves the server.
  const applyCountry = resolveCountryCookie(request, regionMap)

  const segments = request.nextUrl.pathname.split("/").filter(Boolean)
  const firstSegment = segments[0]
  const hasLocaleInUrl = firstSegment && isAppLocale(firstSegment)

  function withCookies(res: NextResponse, locale: string): NextResponse {
    if (!cacheIdCookie) {
      res.cookies.set(COOKIE_NAMES.cacheId, cacheId, { maxAge: 60 * 60 * 24 })
    }
    res.cookies.set(COOKIE_NAMES.locale, locale, persistentCookieOpts)
    return applyCountry(res)
  }

  if (hasLocaleInUrl) {
    const locale = firstSegment

    // Every page under /account beyond the entry point belongs to a signed-in
    // customer, and the account layout only renders the sign-in form for
    // /account itself. Send a signed-out visitor there rather than letting the
    // parallel route fall through to a 404.
    if (
      segments[1] === "account" &&
      segments.length > 2 &&
      !request.cookies.get(COOKIE_NAMES.authToken)
    ) {
      const res = NextResponse.redirect(
        new URL(`/${locale}/account`, request.url)
      )
      return withCookies(res, locale)
    }

    const res = NextResponse.next()
    res.headers.set(INTL_LOCALE_HEADER, locale)
    return withCookies(res, locale)
  }

  // No locale in URL — detect and redirect 302
  const cookieLocale = request.cookies.get(COOKIE_NAMES.locale)?.value

  const locale =
    cookieLocale && isAppLocale(cookieLocale)
      ? cookieLocale
      : (matchBrowserLocale(request.headers.get("accept-language")) ??
        defaultLocale)

  const trailingPath =
    request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname
  const redirectUrl = new URL(`/${locale}${trailingPath}${request.nextUrl.search}`, request.url)
  const res = NextResponse.redirect(redirectUrl, 302)
  return withCookies(res, locale)
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|images|assets|png|svg|jpg|jpeg|gif|webp).*)",
  ],
}
