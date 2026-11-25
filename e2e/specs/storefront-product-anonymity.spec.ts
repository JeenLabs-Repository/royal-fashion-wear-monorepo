import { type APIRequestContext, type Browser, type BrowserContext, type TestInfo, expect, test } from "@playwright/test"
import { loginAsDemo } from "../support/admin-login"
import { appendCredentialEntry } from "../support/credentials-log"

// Precondition. The dev stack runs with the demo catalog seed applied, the
// storefront is built and running, and STOREFRONT_URL and REVALIDATE_SECRET
// are set on both sides. The demo products are the seed's approved ones: one
// stocked in Maharashtra and Karnataka, one stocked in Tamil Nadu, and an
// approved one with no stock.

test.describe.configure({ mode: "serial" })

const BACKEND = process.env.E2E_BACKEND_URL ?? "http://localhost:9000"
const STOREFRONT = process.env.E2E_STOREFRONT_URL ?? "http://localhost:8000"
const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "Gorgo Medusa Store"
const KEY = process.env.E2E_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""

// Strings that may never reach a customer. Demo vendors use fake names and
// example.test addresses; the catalog canary strings apply when the canary
// product exists on the stack.
const FORBIDDEN: (string | RegExp)[] = [
  "Demo Vendor",
  "example.test",
  "vendor_sku",
  "payout",
  /LOC-\d{4}/,
  "CANARY-SKU",
  "Canary Packers",
  "99 Canary Lane",
  "Canary generic",
  "canary-vendor-photo",
  "CANARY-9000",
  "CanaryCam",
]

const KEY_PATTERN =
  /\/products\/(\d+-)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(-[0-9A-Z]{26})?\.webp(\?.*)?$/

type DemoProduct = { id: string; handle: string; title: string; states: string[] }

const leaks = (text: string): string[] =>
  FORBIDDEN.filter((needle) =>
    typeof needle === "string" ? text.toLowerCase().includes(needle.toLowerCase()) : needle.test(text)
  ).map(String)

const storeJson = async <T>(request: APIRequestContext, path: string): Promise<T> => {
  const response = await request.get(`${BACKEND}${path}`, { headers: { "x-publishable-api-key": KEY } })
  expect(response.status(), `GET ${path}`).toBe(200)
  return (await response.json()) as T
}

// Demo products with the states the ship-from route reports for them.
const loadDemoProducts = async (request: APIRequestContext): Promise<DemoProduct[]> => {
  const { products } = await storeJson<{ products: { id: string; handle: string; title: string }[] }>(
    request,
    "/store/products?limit=100&fields=id,handle,title"
  )
  const demo = products.filter((product) => product.title.startsWith("Demo"))
  expect(demo.length, "the demo catalog seed must be applied").toBeGreaterThan(0)
  const { ship_from } = await storeJson<{ ship_from: { product_id: string; states: { name: string }[] }[] }>(
    request,
    `/store/ship-from?product_ids=${demo.map((product) => product.id).join(",")}`
  )
  return demo.map((product) => ({
    ...product,
    states: (ship_from.find((entry) => entry.product_id === product.id)?.states ?? []).map((state) => state.name).sort(),
  }))
}

const productPage = (handle: string) => `${STOREFRONT}/en/products/${handle}`

const adminSession = async (browser: Browser, info: TestInfo): Promise<{ context: BrowserContext; request: APIRequestContext }> => {
  const use = info.project.use
  const context = await browser.newContext({ viewport: use.viewport ?? undefined, userAgent: use.userAgent })
  const page = await context.newPage()
  await loginAsDemo(page, "superadmin")
  return { context, request: context.request }
}

const waitForStatus = async (request: APIRequestContext, url: string, wanted: number, seconds = 20) => {
  const until = Date.now() + seconds * 1000
  let last = 0
  while (Date.now() < until) {
    last = (await request.get(url, { maxRedirects: 5 })).status()
    if (last === wanted) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`${url} still answered ${last} after ${seconds} seconds, expected ${wanted}`)
}

test.beforeAll(() => {
  if (!KEY) {
    throw new Error("Set E2E_PUBLISHABLE_KEY (or NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY) to the storefront's publishable key.")
  }
})

test("shows Ships from with the right states and nothing for a product with no stock", async ({ page, request }) => {
  const demo = await loadDemoProducts(request)

  // Catalog demo seed: Alpha Cotton Tee in Karnataka+Maharashtra, Bravo Sneakers
  // in Delhi, Fleece Hoodie approved with no stock (no Tamil Nadu product exists).
  const two = demo.find((product) => product.states.join() === "Karnataka,Maharashtra")
  const one = demo.find((product) => product.states.join() === "Delhi")
  const none = demo.find((product) => product.states.length === 0)
  expect(two, "a demo product stocked in two states").toBeDefined()
  expect(one, "a demo product stocked in Delhi").toBeDefined()
  expect(none, "an approved demo product with no stock").toBeDefined()

  await page.goto(productPage((two as DemoProduct).handle))
  await expect(page.getByTestId("ship-from-line")).toHaveText("Ships from Karnataka and Maharashtra")

  await page.goto(productPage((one as DemoProduct).handle))
  await expect(page.getByTestId("ship-from-line")).toHaveText("Ships from Delhi")

  await page.goto(productPage((none as DemoProduct).handle))
  await expect(page.getByTestId("product-container")).toBeVisible()
  await expect(page.getByTestId("ship-from-line")).toHaveCount(0)
  await expect(page.getByText("Ships from")).toHaveCount(0)
})

test("keeps vendor text out of the page source, the RSC payload, JSON-LD and image paths", async ({ page, request }) => {
  const [product] = await loadDemoProducts(request)

  const html = await (await request.get(productPage(product.handle), { headers: { accept: "text/html" } })).text()
  const rsc = await (
    await request.get(productPage(product.handle), { headers: { rsc: "1", accept: "text/x-component" } })
  ).text()
  expect(leaks(html)).toEqual([])
  expect(leaks(rsc)).toEqual([])

  await page.goto(productPage(product.handle))
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents()
  expect(blocks.length).toBeGreaterThan(0)
  const nodes = blocks.flatMap((block) => {
    const parsed = JSON.parse(block) as { "@graph"?: Record<string, unknown>[] }
    return parsed["@graph"] ?? [parsed as Record<string, unknown>]
  })
  const productNode = nodes.find((node) => node["@type"] === "Product") as Record<string, any>
  expect(productNode).toBeDefined()
  expect(productNode.brand.name).toBe(SITE_NAME)
  expect(productNode).not.toHaveProperty("mpn")
  const offers = ([] as Record<string, any>[]).concat(productNode.offers ?? [])
  for (const offer of offers) expect(offer.seller.name).toBe(SITE_NAME)
  for (const block of blocks) expect(leaks(block)).toEqual([])

  const sources = await page
    .getByTestId("product-container")
    .locator("img")
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src))
  expect(sources.length).toBeGreaterThan(0)
  for (const source of sources) {
    // The framework's image optimiser wraps the real URL in a query parameter.
    const inner = new URL(source).searchParams.get("url") ?? source
    expect(decodeURIComponent(inner), source).toMatch(KEY_PATTERN)
  }
})

test("hides a suspended vendor's product and brings it back on reactivation", async ({ browser, request }, info) => {
  const demo = await loadDemoProducts(request)
  const target = demo.find((product) => product.states.join() === "Delhi") as DemoProduct
  expect(target, "the Delhi demo product").toBeDefined()

  const { context, request: admin } = await adminSession(browser, info)
  const listed = await admin.get(`${BACKEND}/admin/vendors?q=${encodeURIComponent("Demo Vendor Bravo")}&limit=5`)
  expect(listed.status()).toBe(200)
  const vendorId = ((await listed.json()) as { vendors: { id: string }[] }).vendors[0]?.id
  expect(vendorId, "the Delhi demo vendor").toBeTruthy()

  const reactivate = async () => {
    // Reactivate requires a reason body (same shape as suspend).
    const response = await admin.post(`${BACKEND}/admin/vendors/${vendorId}/reactivate`, {
      data: { reason: "Storefront check finished, restoring the demo vendor." },
    })
    expect(response.status()).toBe(200)
  }

  try {
    const suspend = await admin.post(`${BACKEND}/admin/vendors/${vendorId}/suspend`, {
      data: { reason: "Storefront check, reactivated at the end of the run." },
    })
    expect(suspend.status()).toBe(200)

    await waitForStatus(request, productPage(target.handle), 404)
    const { products } = await storeJson<{ products: { id: string }[] }>(request, "/store/products?limit=100&fields=id")
    expect(products.map((product) => product.id)).not.toContain(target.id)

    await reactivate()
    await waitForStatus(request, productPage(target.handle), 200)
    const again = await loadDemoProducts(request)
    expect(again.find((product) => product.id === target.id)?.states).toEqual(["Delhi"])
  } finally {
    // Always leave the demo vendor active, even when an assertion failed above.
    const status = await admin.get(`${BACKEND}/admin/vendors/${vendorId}`)
    if (status.ok() && JSON.stringify(await status.json()).includes('"suspended"')) {
      await reactivate()
    }
    await context.close()
    appendCredentialEntry({
      section: "Storefront anonymity browser spec",
      what: `Demo vendor ${vendorId} suspended and reactivated by the storefront product spec`,
      flow: "storefront-product-anonymity spec, suspension test",
      reset: "reactivate the demo vendor in the Admin vendors screen if a run was interrupted",
      values: `product ${target.handle}`,
    })
  }
})

test("search finds an approved title and never a vendor SKU", async ({ page, request }) => {
  const [product] = await loadDemoProducts(request)

  const search = async (text: string) => {
    await page.goto(`${STOREFRONT}/en`)
    await page.getByRole("button", { name: "Search" }).first().click()
    const box = page.getByPlaceholder("Search products")
    await box.fill(text)
    return box
  }

  await search(product.title)
  await expect(page.getByRole("link", { name: new RegExp(product.title) }).first()).toBeVisible()

  // The demo vendor SKUs follow the seed's pattern; the canary SKU is searched as well.
  for (const needle of ["CANARY-SKU-ALPHA-1", "Demo Vendor Alpha"]) {
    await search(needle)
    await expect(page.getByText(/No results for/)).toBeVisible()
  }
})

test("shows no declaration block in the default display mode", async ({ page, request }) => {
  const demo = await loadDemoProducts(request)
  for (const product of demo.slice(0, 3)) {
    await page.goto(productPage(product.handle))
    await expect(page.getByTestId("product-container")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Product information" })).toHaveCount(0)
    await expect(page.getByTestId("product-declarations")).toHaveCount(0)
    await expect(page.getByText(/Marketed by|Packed by/)).toHaveCount(0)
  }
})
