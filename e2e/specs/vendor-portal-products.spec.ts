import { deflateSync } from "node:zlib"
import { type Browser, type BrowserContext, type Page, type TestInfo, expect, test } from "@playwright/test"
import {
  navigateInApp,
  portalUrl,
  signIn,
  signInFreshVendor,
  type VendorCredentials,
} from "../helpers/vendor-flow"
import { appendCredentialEntry } from "../support/credentials-log"

// Precondition. The dev stack runs with the demo vendor seed applied and the
// store has at least one product category. Both vendors are created fresh in
// the first hook, so the empty-state flow always starts from no products.
//
// The portal keeps the bearer token in page memory only (no cookie, no
// storage), so Playwright storageState cannot restore a session. Each test
// signs in with the credentials returned from the fresh-vendor seed.

test.describe.configure({ mode: "serial" })
test.describe.configure({ timeout: 120_000 })

type Vendor = VendorCredentials & { email: string }

const RUN = Date.now()
const TITLE = `Spec Kurta ${RUN}`
const SKU_A = `SPEC-${RUN}-S`
const SKU_B = `SPEC-${RUN}-M`

let vendorA: Vendor
let vendorB: Vendor
let productPath = ""

// PNG bytes built at run time, so no binary file is committed.
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
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

const IMAGES = [
  { name: "spec-one.png", mimeType: "image/png", buffer: makePng(200, 40, 40) },
  { name: "spec-two.png", mimeType: "image/png", buffer: makePng(40, 40, 200) },
]

const newContext = (browser: Browser, info: TestInfo) => {
  const use = info.project.use
  return browser.newContext({
    viewport: use.viewport ?? undefined,
    userAgent: use.userAgent,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
  })
}

const createVendor = async (browser: Browser, info: TestInfo): Promise<Vendor> => {
  const context = await newContext(browser, info)
  const page = await context.newPage()
  const credentials = await signInFreshVendor(page, { status: "active" })
  await context.close()
  return credentials
}

const asVendor = async (browser: Browser, info: TestInfo, vendor: Vendor) => {
  const context = await newContext(browser, info)
  const page = await context.newPage()
  const usedStep = await signIn(page, vendor)
  vendor.usedStep = usedStep
  return { context, page }
}

const openRoute = async (page: Page, route: string) => {
  await navigateInApp(page, route)
}

const idFromUrl = (url: string): string => {
  const match = /\/products\/([^/?#]+)$/.exec(new URL(url).pathname)
  if (!match) throw new Error(`No product id in ${url}`)
  return match[1]
}

const fillBasics = async (page: Page) => {
  await page.getByLabel("Title", { exact: true }).fill(TITLE)
  await page.getByLabel("Description", { exact: true }).fill("Soft cotton kurta for everyday wear.")
}

const addOptionAndGenerate = async (page: Page) => {
  await page.getByRole("button", { name: "Add option" }).click()
  await page.getByLabel("Option 1 name").fill("Size")
  await page.getByLabel("Option 1 values, separated by commas").fill("S, M")
  await page.getByRole("button", { name: "Generate variants" }).click()
  await expect(page.getByLabel("Vendor SKU, variant 2")).toBeVisible()
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(240_000)
  // Enrolment waits for the MFA secret; under load the start response can take
  // longer than the default 5 s expect timeout.
  vendorA = await createVendor(browser, info)
  vendorB = await createVendor(browser, info)
})

test("a vendor with no products sees the explanation and a way to start", async ({ browser }, info) => {
  const { context, page } = await asVendor(browser, info, vendorA)
  try {
    await openRoute(page, "/products")
    await expect(page.getByTestId("screen-products")).toBeVisible()
    await expect(page.getByTestId("products-empty")).toContainText(
      "You have no products yet. A product starts as a draft. You send it for review and the store team decides before it goes on sale."
    )
    await expect(page.getByRole("button", { name: "Create product" }).first()).toBeVisible()
  } finally {
    await context.close()
  }
})

test("a draft shows an inline error on the price field and saves once it is fixed", async ({ browser }, info) => {
  const { context, page } = await asVendor(browser, info, vendorA)
  try {
    await openRoute(page, "/products/new")
    await fillBasics(page)

    await page.locator("#product-images").setInputFiles(IMAGES)
    await expect(page.getByTestId("image-count")).toHaveText("2 of 10", { timeout: 90_000 })
    await expect(page.getByRole("img", { name: /Product image/ })).toHaveCount(2)

    await addOptionAndGenerate(page)
    await page.getByLabel("Vendor SKU, variant 1").fill(SKU_A)
    await page.getByLabel("Payout price (INR), variant 1").fill("0")

    await page.getByRole("button", { name: "Save draft" }).click()
    await expect(page.getByTestId("error-variants.0.payout_price")).toBeVisible()
    await expect(page).toHaveURL(/\/products\/new$/)

    await page.getByLabel("Payout price (INR), variant 1").fill("199.99")
    await page.getByLabel("MRP (INR), variant 1").fill("499")
    await page.getByLabel("Net quantity, variant 1").fill("1")
    await page.getByLabel("Net quantity unit, variant 1").selectOption("pcs")
    await page.getByLabel("Vendor SKU, variant 2").fill(SKU_B)
    await page.getByLabel("Payout price (INR), variant 2").fill("209.99")

    await page.getByLabel("Category").selectOption({ index: 1 })
    await page.getByLabel("GST class").selectOption({ value: "GST-5" })
    await page.getByLabel("HSN code").fill("6109")
    await page.getByLabel("Generic name").fill("Kurta")
    // Country defaults to India; set by value so mobile does not open the long list.
    await page.locator("#declaration-country").selectOption({ value: "IN" })
    await page.getByLabel("Packed or marketed by (name)").fill("Example Packer")
    await page.getByLabel("Packed or marketed by (address)").fill("1 Example Road, Mumbai")

    await page.screenshot({ path: info.outputPath("form-filled.png"), fullPage: true })
    await page.getByRole("button", { name: "Save draft" }).click()
    await expect(page).toHaveURL(/\/products\/[^/]+$/, { timeout: 60_000 })
    await expect(page).not.toHaveURL(/\/products\/new$/)
    await expect(page.getByTestId("state-chip")).toHaveText("Draft")
    productPath = new URL(page.url()).pathname.replace(/^\/vendor-portal/, "")

    await openRoute(page, "/products")
    const row = page.getByRole("row", { name: new RegExp(TITLE) })
    await expect(row).toContainText("Draft")
    await page.screenshot({ path: info.outputPath("list.png"), fullPage: true })

    appendCredentialEntry({
      section: "Vendor portal browser specs",
      what: `Draft product "${TITLE}" owned by the vendor ${vendorA.email}`,
      flow: "vendor-portal-products.spec.ts",
      reset: "withdraw it in the portal, or rerun the vendor seed with --reset",
      values: `product ${idFromUrl(`${portalUrl}${productPath}`)}; sign in as the vendor named above`,
    })
  } finally {
    await context.close()
  }
})

test("submitting locks the product while it is in review", async ({ browser }, info) => {
  const { context, page } = await asVendor(browser, info, vendorA)
  try {
    await openRoute(page, productPath)
    await page.getByRole("button", { name: "Submit for review" }).click()
    await page.getByRole("button", { name: "Confirm" }).click()

    await expect(page.getByTestId("state-chip")).toHaveText("In review")
    await expect(page.getByText("This product is in review and cannot be changed")).toBeVisible()
    await expect(page.getByLabel("Title", { exact: true })).toBeDisabled()
    await expect(page.getByLabel("Vendor SKU, variant 1")).toBeDisabled()
    await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test("withdrawing allows an edit and a second submission", async ({ browser }, info) => {
  const { context, page } = await asVendor(browser, info, vendorA)
  try {
    await openRoute(page, productPath)
    await page.getByRole("button", { name: "Withdraw" }).click()
    await expect(page.getByText("Withdrawing takes this product off sale.")).toBeVisible()
    await page.getByRole("button", { name: "Confirm" }).click()
    await expect(page.getByTestId("state-chip")).toHaveText("Withdrawn")

    await page.getByLabel("Title", { exact: true }).fill(`${TITLE} Updated`)
    await page.getByRole("button", { name: "Save draft" }).click()
    await expect(page.getByTestId("form-saved")).toBeVisible()

    await page.getByRole("button", { name: "Submit for review" }).click()
    await page.getByRole("button", { name: "Confirm" }).click()
    await expect(page.getByTestId("state-chip")).toHaveText("In review")
  } finally {
    await context.close()
  }
})

test("another vendor cannot open the product and does not see it listed", async ({ browser }, info) => {
  const { context, page } = await asVendor(browser, info, vendorB)
  try {
    await openRoute(page, productPath)
    await expect(page.getByText("The page you opened does not exist.")).toBeVisible()

    await openRoute(page, "/products")
    await expect(page.getByTestId("products-empty")).toBeVisible()
    await expect(page.getByText(TITLE)).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test("the list and the form fit a 375 px screen without sideways scrolling", async ({ browser }, info) => {
  const { context, page } = await asVendor(browser, info, vendorA)
  try {
    await page.setViewportSize({ width: 375, height: 812 })
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

    await openRoute(page, "/products")
    await expect(page.getByTestId("screen-products")).toBeVisible()
    expect(await fits()).toBe(true)
    await page.screenshot({ path: info.outputPath("list-375.png"), fullPage: true })

    await openRoute(page, "/products/new")
    await addOptionAndGenerate(page)
    expect(await fits()).toBe(true)
    const save = page.getByRole("button", { name: "Save draft" })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeVisible()
    await expect(save).toBeEnabled()
    await page.screenshot({ path: info.outputPath("form-375.png"), fullPage: true })

    await openRoute(page, productPath)
    await expect(page.getByTestId("screen-product-form")).toBeVisible()
    expect(await fits()).toBe(true)
  } finally {
    await context.close()
  }
})

test("every input on the form has an accessible name", async ({ browser }, info) => {
  const { context, page } = await asVendor(browser, info, vendorA)
  try {
    await openRoute(page, "/products/new")
    await addOptionAndGenerate(page)

    const unnamed = await page.evaluate(() => {
      const controls = Array.from(document.querySelectorAll("input, select, textarea")).filter(
        (element) => (element as HTMLInputElement).type !== "hidden"
      ) as HTMLInputElement[]
      return controls
        .filter((element) => {
          const labelled = (element.labels?.length ?? 0) > 0
          const aria = element.getAttribute("aria-label") || element.getAttribute("aria-labelledby")
          return !labelled && !aria
        })
        .map((element) => element.outerHTML.slice(0, 120))
    })
    expect(unnamed).toEqual([])
    await expect(page.getByLabel("Vendor SKU, variant 1")).toBeVisible()
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible()
  } finally {
    await context.close()
  }
})
