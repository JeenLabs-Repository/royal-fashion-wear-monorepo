import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { deflateSync } from "node:zlib"
import { type Browser, type Page, type TestInfo, expect, test } from "@playwright/test"
import {
  enrolTotp,
  finishEnrolment,
  portalUrl,
  signIn,
} from "../helpers/vendor-flow"
import { defaultTarget, loginAsDemo } from "../support/admin-login"
import { appendCredentialEntry } from "../support/credentials-log"

// Precondition. The demo catalog seed is applied; Alpha is a demo vendor with
// locations; the demo catalog approver exists; the storefront is running;
// STOREFRONT_URL and REVALIDATE_SECRET match; E2E_PUBLISHABLE_KEY is set.

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The Admin dashboard is not a phone interface, so this flow runs on the desktop project only"
  )
})

const BACKEND = process.env.E2E_BACKEND_URL ?? "http://localhost:9000"
const STOREFRONT = process.env.E2E_STOREFRONT_URL ?? "http://localhost:8000"
const KEY =
  process.env.E2E_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""
const { adminUrl } = defaultTarget()
const RUN = Date.now()
const TITLE = `E2E Draft Live ${RUN}`
const NEW_TITLE = `${TITLE} Updated`
const SKU_A = `E2E-${RUN}-S`
const SKU_B = `E2E-${RUN}-M`
const SEED_FILE = path.resolve(process.cwd(), "e2e", ".auth", "vendor-seed.json")

const CHECKS = [
  "check-no_identifying_text",
  "check-no_watermark_or_logo",
  "check-images_checked",
  "check-declarations_reviewed",
  "check-gst_and_hsn_set",
  "check-selling_price_set",
]

const crcTable = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table.push(c >>> 0)
  }
  return table
})()
const crc32 = (buffer: Buffer): number => {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}
const makePng = (r: number, g: number, b: number, size = 16): Buffer => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat()),
  ])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}
const IMAGES = [
  { name: "e2e-one.png", mimeType: "image/png", buffer: makePng(200, 40, 40) },
  { name: "e2e-two.png", mimeType: "image/png", buffer: makePng(40, 40, 200) },
]

const demoVendor = () => {
  const seed = JSON.parse(readFileSync(SEED_FILE, "utf8")) as {
    vendors: Record<string, Record<string, string>>
  }
  const entry = seed.vendors.alpha
  const secret = entry?.totp_secret ?? entry?.secret
  if (!entry?.email || !entry.password) {
    throw new Error(
      'e2e/.auth/vendor-seed.json has no complete "alpha" entry. Run the vendor seed and the catalog demo seed first.'
    )
  }
  return { email: entry.email, password: entry.password, secret: secret ?? "" }
}

const persistSecret = (secret: string) => {
  const seed = JSON.parse(readFileSync(SEED_FILE, "utf8")) as {
    vendors: Record<string, Record<string, string>>
  }
  seed.vendors.alpha = { ...seed.vendors.alpha, totp_secret: secret }
  writeFileSync(SEED_FILE, `${JSON.stringify(seed, null, 2)}\n`)
}

const signInOrEnrol = async (page: Page) => {
  const demo = demoVendor()
  if (demo.secret) {
    await signIn(page, demo)
    return
  }
  await page.goto(`${portalUrl}/login`)
  await page.getByTestId("login-email").fill(demo.email)
  await page.getByTestId("login-password").fill(demo.password)
  await page.getByTestId("login-submit").click()
  await expect
    .poll(async () => {
      if (page.url().includes("/mfa")) return "mfa"
      if (await page.getByTestId("login-code").count()) return "challenge"
      if (await page.getByTestId("screen-home").count()) return "home"
      return "wait"
    })
    .not.toBe("wait")
  if (await page.getByTestId("login-code").count()) {
    throw new Error(
      "Demo vendor alpha has MFA enrolled but no totp_secret in e2e/.auth/vendor-seed.json."
    )
  }
  if (page.url().includes("/mfa")) {
    const enrolled = await enrolTotp(page)
    persistSecret(enrolled.secret)
    appendCredentialEntry({
      section: "Catalog draft to live spec",
      what: `TOTP secret for ${demo.email}`,
      flow: "catalog-draft-to-live.spec.ts enrolment",
      reset: "rerun the vendor seed with --reset, or disable the MFA factor",
      values: `secret ${enrolled.secret}`,
    })
    await finishEnrolment(page, demo, enrolled)
    return
  }
  await expect(page.getByTestId("screen-home")).toBeVisible()
}

const newContext = (browser: Browser, info: TestInfo) => {
  const use = info.project.use
  return browser.newContext({ viewport: use.viewport ?? undefined, userAgent: use.userAgent })
}

const goTo = (page: Page, label: string) =>
  page.getByRole("link", { name: label, exact: true }).click()

const openProduct = async (page: Page, title: string) => {
  await goTo(page, "Products")
  const row = page.getByRole("row", { name: new RegExp(title) })
  await expect(row).toBeVisible()
  await row.getByRole("link").first().click()
  await expect(page).toHaveURL(/\/products\/(?!new$)[^/]+$/)
}

const store = async (page: Page, query: string) => {
  const response = await page.request.get(`${BACKEND}/store/products?${query}`, {
    headers: { "x-publishable-api-key": KEY },
  })
  expect(response.status()).toBe(200)
  return (await response.json()) as {
    products: { id: string; handle: string; title: string; variants?: { sku: string }[] }[]
  }
}

const waitFor = async (check: () => Promise<boolean>, what: string, seconds = 20) => {
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`${what} did not happen within ${seconds} seconds`)
}

const storefrontStatus = async (page: Page, handle: string) =>
  (await page.request.get(`${STOREFRONT}/en/products/${handle}`)).status()

const reviewFor = async (page: Page, title: string, tab: string) => {
  await page.goto(`${adminUrl}/product-reviews`)
  await page.getByRole("tab", { name: tab }).click()
  const loading = page.getByText("Loading product reviews")
  await expect(loading).toHaveCount(0, { timeout: 15_000 })
  // Oldest first with 25 per page; wait for the summary to change after Next.
  const row = page.getByRole("row", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
  const summary = page.getByText(/\d+ to \d+ of \d+/)
  for (let pageIndex = 0; pageIndex < 40; pageIndex++) {
    if ((await row.count()) > 0) break
    const next = page.getByRole("button", { name: "Next" })
    if ((await next.count()) === 0 || (await next.isDisabled())) break
    const before = (await summary.count()) > 0 ? await summary.first().innerText() : ""
    await next.click()
    await expect(loading).toHaveCount(0, { timeout: 15_000 })
    if (before) {
      await expect(summary.first()).not.toHaveText(before, { timeout: 15_000 })
    }
  }
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.getByRole("link", { name: "Open" }).click()
  await expect(page.getByTestId("review-title")).toHaveText(title)
}

const tickAll = async (page: Page) => {
  for (const id of CHECKS) await page.getByTestId(id).click()
}

const pickOption = async (page: Page, testId: string, name: string | RegExp) => {
  await page.getByTestId(testId).click()
  await page.getByRole("option", { name }).first().click()
}

const confirm = (page: Page) => page.getByRole("button", { name: "Confirm" }).click()

const fillApprovalFields = async (page: Page, skuA: string, skuB: string) => {
  await tickAll(page)
  await page.getByTestId(`price-${skuA}`).fill("249.00")
  await page.getByTestId(`price-${skuB}`).fill("259.00")
  await pickOption(page, "gst-select", "GST-5")
  const hsn = page.getByTestId("hsn-input")
  if (!(await hsn.inputValue())) await hsn.fill("6109")
  if ((await page.getByTestId("category-select").innerText()).includes("Choose")) {
    await pickOption(page, "category-select", /.+/)
  }
}

test("a product goes from draft to live, is edited, and is withdrawn across four actors", async ({
  browser,
}, info) => {
  test.setTimeout(420_000)
  expect(
    KEY,
    "Set E2E_PUBLISHABLE_KEY to a publishable key linked to the default sales channel"
  ).not.toBe("")

  const vendorContext = await newContext(browser, info)
  const vendorPage = await vendorContext.newPage()
  await signInOrEnrol(vendorPage)

  const adminContext = await newContext(browser, info)
  const adminPage = await adminContext.newPage()
  await loginAsDemo(adminPage, "catalog_approver")

  const customerContext = await newContext(browser, info)
  const customerPage = await customerContext.newPage()

  let productId = ""
  let handle = ""
  try {
    await goTo(vendorPage, "Products")
    await vendorPage
      .getByRole("link", { name: "Create product" })
      .or(vendorPage.getByRole("button", { name: "Create product" }))
      .click()
    await vendorPage.getByLabel("Title", { exact: true }).fill(TITLE)
    await vendorPage
      .getByLabel("Description", { exact: true })
      .fill("Soft cotton kurta for everyday wear.")
    await vendorPage.getByLabel("Add images").setInputFiles(IMAGES)
    await expect(vendorPage.getByRole("img", { name: /Product image/ })).toHaveCount(2)
    await vendorPage.getByRole("button", { name: "Add option" }).click()
    await vendorPage.getByLabel("Option 1 name").fill("Size")
    await vendorPage.getByLabel("Option 1 values, separated by commas").fill("S, M")
    await vendorPage.getByRole("button", { name: "Generate variants" }).click()
    await vendorPage.getByLabel("Vendor SKU, variant 1").fill(SKU_A)
    await vendorPage.getByLabel("Payout price (INR), variant 1").fill("199.99")
    await vendorPage.getByLabel("MRP (INR), variant 1").fill("499")
    await vendorPage.getByLabel("Net quantity, variant 1").fill("1")
    await vendorPage.getByLabel("Net quantity unit, variant 1").selectOption("pcs")
    await vendorPage.getByLabel("Vendor SKU, variant 2").fill(SKU_B)
    await vendorPage.getByLabel("Payout price (INR), variant 2").fill("209.99")
    await vendorPage.getByLabel("MRP (INR), variant 2").fill("499")
    await vendorPage.getByLabel("Category").selectOption({ index: 1 })
    await vendorPage.getByLabel("GST class").selectOption("GST-5")
    await vendorPage.getByLabel("HSN code").fill("6109")
    await vendorPage.getByLabel("Generic name").fill("Kurta")
    await vendorPage.getByLabel("Country of origin").selectOption("IN")
    await vendorPage.getByLabel("Packed or marketed by (name)").fill("Example Packer")
    await vendorPage.getByLabel("Packed or marketed by (address)").fill("1 Example Road, Mumbai")
    await vendorPage.getByRole("button", { name: "Save draft" }).click()
    await expect(vendorPage).toHaveURL(/\/products\/(?!new$)[^/]+$/)
    productId = new URL(vendorPage.url()).pathname.split("/").pop() as string
    await vendorPage.getByRole("button", { name: "Submit for review" }).click()
    await confirm(vendorPage)
    await expect(vendorPage.getByTestId("state-chip")).toHaveText("In review")

    await goTo(vendorPage, "Products")
    await expect(vendorPage.getByRole("row", { name: new RegExp(TITLE) })).toContainText(
      "In review"
    )
    expect(
      (await store(customerPage, `q=${encodeURIComponent(TITLE)}&fields=id,title`)).products
    ).toEqual([])

    await reviewFor(adminPage, TITLE, "New")
    await fillApprovalFields(adminPage, SKU_A, SKU_B)
    await adminPage.getByTestId("approve").click()
    await expect(adminPage.getByText("Product approved")).toBeVisible()

    const listed = await store(customerPage, `id=${productId}&fields=id,handle,title,*variants`)
    expect(listed.products.length).toBe(1)
    handle = listed.products[0].handle
    expect(handle).toMatch(/^[a-z0-9-]+-[a-z2-7]{5}$/)
    const skus = (listed.products[0].variants ?? []).map((variant) => variant.sku)
    expect(skus.length).toBe(2)
    for (const sku of skus) expect(sku).toMatch(/^PL-\d{8}$/)
    const raw = JSON.stringify(listed)
    expect(raw).not.toContain(SKU_A)
    expect(raw).not.toContain(SKU_B)

    await goTo(vendorPage, "Stock")
    await vendorPage.getByTestId("stock-search").fill(TITLE)
    const row = vendorPage.locator(`[data-testid="stock-row"][data-sku="${SKU_A}"]`)
    await expect(row).toBeVisible()
    const location = (await vendorPage
      .locator("th[data-location-code]")
      .first()
      .getAttribute("data-location-code")) as string
    await row.locator(`input[data-location-code="${location}"]`).fill("10")
    await row.getByRole("button", { name: "Save" }).click()
    await expect(row.getByTestId("stock-unsaved")).toHaveCount(0)

    await goTo(vendorPage, "Locations")
    const locationRow = vendorPage.getByTestId(`location-row-${location}`)
    await expect(locationRow).toBeVisible()
    const state = (await locationRow.locator("td").nth(2).innerText()).trim()
    expect(state, `the Locations screen row for ${location} must name a state`).toBeTruthy()

    await waitFor(
      async () => (await storefrontStatus(customerPage, handle)) === 200,
      "the storefront page"
    )
    const productTitle = () => customerPage.locator('h1[data-testid="product-title"]')
    const storefrontShows = async (expected: string) => {
      const response = await customerPage.request.get(`${STOREFRONT}/en/products/${handle}`, {
        headers: { "cache-control": "no-cache" },
      })
      if (response.status() !== 200) return false
      const html = await response.text()
      return html.includes(`>${expected}<`) || html.includes(expected)
    }
    await customerPage.goto(`${STOREFRONT}/en/products/${handle}`)
    await expect(productTitle()).toHaveText(TITLE)
    await waitFor(async () => {
      await customerPage.reload()
      return (await customerPage.getByTestId("ship-from-line").count()) > 0
    }, "the ship-from line")
    await expect(customerPage.getByTestId("ship-from-line")).toHaveText(`Ships from ${state}`)
    if (await customerPage.getByTestId("product-options").count()) {
      await customerPage
        .getByTestId("product-options")
        .getByRole("button", { name: "S", exact: true })
        .click()
    } else {
      await customerPage.getByRole("button", { name: "S", exact: true }).click()
    }
    await expect(customerPage.getByTestId("add-product-button")).toBeEnabled()

    await openProduct(vendorPage, TITLE)
    await vendorPage.getByLabel("Title", { exact: true }).fill(NEW_TITLE)
    await vendorPage.getByRole("button", { name: "Save change for review" }).click()
    await confirm(vendorPage)
    const submit = vendorPage.getByRole("button", { name: "Submit for review" })
    if ((await submit.count()) > 0 && (await submit.isEnabled())) {
      await submit.click()
      await confirm(vendorPage)
    }
    await expect(vendorPage.getByText("Change waiting for review")).toBeVisible()
    await customerPage.goto(`${STOREFRONT}/en/products/${handle}`)
    await expect(productTitle()).toHaveText(TITLE)

    await reviewFor(adminPage, NEW_TITLE, "Live edits")
    await fillApprovalFields(adminPage, SKU_A, SKU_B)
    await expect(adminPage.getByTestId("approve")).toBeEnabled()
    await adminPage.getByTestId("approve").click()
    await expect(adminPage.getByText("Product approved")).toBeVisible()
    await waitFor(async () => {
      const listed = await store(customerPage, `id=${productId}&fields=id,title,handle`)
      if (listed.products[0]?.title !== NEW_TITLE) return false
      return storefrontShows(NEW_TITLE)
    }, "the new title on the storefront", 45)
    await customerPage.goto(`${STOREFRONT}/en/products/${handle}`)
    await expect(productTitle()).toHaveText(NEW_TITLE)
    expect(
      (await store(customerPage, `id=${productId}&fields=id,handle`)).products[0].handle
    ).toBe(handle)

    await openProduct(vendorPage, NEW_TITLE)
    await vendorPage.getByRole("button", { name: "Withdraw" }).click()
    await confirm(vendorPage)
    await expect(vendorPage.getByTestId("state-chip")).toHaveText("Withdrawn")
    await waitFor(
      async () => (await storefrontStatus(customerPage, handle)) === 404,
      "the storefront 404"
    )
    expect(
      (await store(customerPage, `q=${encodeURIComponent(NEW_TITLE)}&fields=id`)).products
    ).toEqual([])
  } finally {
    appendCredentialEntry({
      section: "Catalog draft to live spec",
      what: `Product "${NEW_TITLE}" (core id ${productId || "not created"}, handle ${handle || "not assigned"}) owned by the demo vendor Alpha, now withdrawn, with 10 units at one location`,
      flow: "catalog-draft-to-live.spec.ts",
      reset:
        "nothing is needed for reruns, titles are unique; remove the product by re-creating the dev database",
      values: `vendor SKUs ${SKU_A} and ${SKU_B}; approved by the demo catalog approver`,
    })
    await vendorContext.close()
    await adminContext.close()
    await customerContext.close()
  }
})
