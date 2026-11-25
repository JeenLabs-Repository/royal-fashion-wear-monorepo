import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
  expect,
  test,
} from "@playwright/test"
import {
  enrolTotp,
  finishEnrolment,
  portalUrl,
  signIn,
} from "../helpers/vendor-flow"
import { loginAsDemo } from "../support/admin-login"
import { appendCredentialEntry } from "../support/credentials-log"

// Precondition. The dev stack runs with the demo catalog seed applied. Alpha
// has at least two locations and live products, Bravo has one location. The
// flows run in order: the reserved-number flow leaves a reservation that the
// import flow uses, and the last hook removes it.

test.describe.configure({ mode: "serial" })
test.describe.configure({ timeout: 120_000 })

const BACKEND = process.env.E2E_BACKEND_URL ?? "http://localhost:9000"
const RUN = Date.now()
const MARKER_QUANTITY = 1337
const SEED_FILE = path.resolve(process.cwd(), "e2e", ".auth", "vendor-seed.json")

type Demo = { email: string; password: string; secret: string }
type Vendor = { context: BrowserContext; page: Page }

const usedStep: Record<string, number> = {}

// RESOLVE: seed keys are alpha and bravo (not beta). Catalog demo products live
// on those accounts. TOTP secrets are written back into the gitignored seed file
// after the first enrolment so later sign-ins can answer the challenge.
const demoVendor = (key: "alpha" | "bravo"): Demo => {
  const seed = JSON.parse(readFileSync(SEED_FILE, "utf8")) as {
    vendors: Record<string, Record<string, string>>
  }
  const entry = seed.vendors[key]
  const secret = entry?.totp_secret ?? entry?.secret
  if (!entry?.email || !entry.password) {
    throw new Error(
      `e2e/.auth/vendor-seed.json has no complete "${key}" entry. Run the vendor seed and the catalog demo seed first.`
    )
  }
  return { email: entry.email, password: entry.password, secret: secret ?? "" }
}

const persistSecret = (key: "alpha" | "bravo", secret: string) => {
  const seed = JSON.parse(readFileSync(SEED_FILE, "utf8")) as {
    vendors: Record<string, Record<string, string>>
  }
  seed.vendors[key] = { ...seed.vendors[key], totp_secret: secret }
  writeFileSync(SEED_FILE, `${JSON.stringify(seed, null, 2)}\n`)
}

const signInOrEnrol = async (page: Page, key: "alpha" | "bravo"): Promise<number> => {
  const demo = demoVendor(key)
  if (demo.secret) {
    return signIn(page, { ...demo, usedStep: usedStep[key] })
  }

  await page.goto(`${portalUrl}/login`)
  await page.getByTestId("login-email").fill(demo.email)
  await page.getByTestId("login-password").fill(demo.password)
  await page.getByTestId("login-submit").click()

  await expect
    .poll(async () => {
      const url = page.url()
      if (url.includes("/mfa")) return "mfa"
      if (await page.getByTestId("login-code").count()) return "challenge"
      if (await page.getByTestId("screen-home").count()) return "home"
      return "wait"
    })
    .not.toBe("wait")

  if (await page.getByTestId("login-code").count()) {
    throw new Error(
      `Demo vendor "${key}" has MFA enrolled but no totp_secret in e2e/.auth/vendor-seed.json. Reset the factor or record the secret.`
    )
  }

  if (page.url().includes("/mfa")) {
    const enrolled = await enrolTotp(page)
    persistSecret(key, enrolled.secret)
    appendCredentialEntry({
      section: "Vendor portal stock spec",
      what: `TOTP secret for ${demo.email}`,
      flow: "vendor-portal-stock.spec.ts enrolment",
      reset: "rerun the vendor seed with --reset, or disable the MFA factor",
      values: `secret ${enrolled.secret}`,
    })
    return finishEnrolment(page, demo, enrolled)
  }

  await expect(page.getByTestId("screen-home")).toBeVisible()
  return 0
}

let alpha: Vendor
let beta: Vendor
let alphaSkus: string[] = []
let betaSkus: string[] = []
let locationCodes: string[] = []
let targetSku = ""
let secondSku = ""
let reservationId = ""

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

const signInVendor = async (
  browser: Browser,
  info: TestInfo,
  key: "alpha" | "bravo"
): Promise<Vendor> => {
  const context = await newContext(browser, info)
  const page = await context.newPage()
  usedStep[key] = await signInOrEnrol(page, key)
  return { context, page }
}

const goTo = (page: Page, label: string) =>
  page.getByRole("link", { name: label, exact: true }).click()

const openStock = async (page: Page) => {
  if ((await page.getByTestId("stock-table").count()) > 0) await goTo(page, "Home")
  const [reply] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/vendor/inventory") && response.request().method() === "GET"
    ),
    goTo(page, "Stock"),
  ])
  expect(reply.status()).toBe(200)
  await expect(page.getByTestId("stock-table")).toBeVisible()
}

const rowOf = (page: Page, sku: string) =>
  page.locator(`[data-testid="stock-row"][data-sku="${sku}"]`)
const inputOf = (page: Page, sku: string, location: string) =>
  rowOf(page, sku).locator(`input[data-location-code="${location}"]`)
const cellOf = (page: Page, sku: string, location: string) =>
  rowOf(page, sku).locator(`td:has(input[data-location-code="${location}"])`)
const saveRow = async (page: Page, sku: string) => {
  await rowOf(page, sku).getByRole("button", { name: "Save" }).click()
  await expect(rowOf(page, sku).getByTestId("stock-unsaved")).toHaveCount(0)
}

const skusOnPage = (page: Page) =>
  page
    .locator('[data-testid="stock-row"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-sku") ?? ""))
const codesOnPage = (page: Page) =>
  page
    .locator("th[data-location-code]")
    .evaluateAll((heads) => heads.map((head) => head.getAttribute("data-location-code") ?? ""))

const adminSession = async (
  browser: Browser,
  info: TestInfo
): Promise<{ context: BrowserContext; request: APIRequestContext }> => {
  const context = await newContext(browser, info)
  const page = await context.newPage()
  await loginAsDemo(page, "superadmin")
  return { context, request: context.request }
}

// The portal builds a blob URL from the CSV text response. Desktop Chromium
// emits a Playwright download for that click; the phone project often does not.
// Reading the network response is reliable on both.
const readDownload = async (
  page: Page,
  buttonName: string,
  pathNeedle: string
): Promise<string> => {
  const button = page.getByTestId("csv-panel").getByRole("button", { name: buttonName })
  await button.scrollIntoViewIfNeeded()
  await expect(button).toBeVisible()
  const responsePromise = page.waitForResponse(
    (entry) => entry.url().includes(pathNeedle) && entry.request().method() === "GET",
    { timeout: 30_000 }
  )
  await button.click({ force: true })
  const response = await responsePromise
  expect(response.status()).toBe(200)
  return (await response.text()).replace(/^\uFEFF/, "")
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(240_000)
  alpha = await signInVendor(browser, info, "alpha")
  beta = await signInVendor(browser, info, "bravo")
})

test.afterAll(async ({ browser }, info) => {
  try {
    if (reservationId) {
      const { context, request } = await adminSession(browser, info)
      try {
        await request.delete(`${BACKEND}/admin/reservations/${reservationId}`)
      } finally {
        await context.close()
      }
    }
  } finally {
    await alpha?.context.close()
    await beta?.context.close()
  }
})

test("each vendor sees only its own locations and products", async () => {
  await openStock(alpha.page)
  locationCodes = await codesOnPage(alpha.page)
  // Alpha is seeded with two locations; repeated demo runs can leave extras.
  expect(locationCodes.length, "Alpha has at least two locations").toBeGreaterThanOrEqual(2)
  locationCodes = locationCodes.slice(0, 2)
  alphaSkus = await skusOnPage(alpha.page)
  expect(alphaSkus.length).toBeGreaterThanOrEqual(2)
  targetSku = alphaSkus[0]
  secondSku = alphaSkus.find((sku) => sku !== targetSku) as string

  await openStock(beta.page)
  expect((await codesOnPage(beta.page)).length, "Bravo has one location").toBe(1)
  betaSkus = await skusOnPage(beta.page)
  expect(betaSkus.length).toBeGreaterThan(0)
  for (const sku of betaSkus) expect(alphaSkus).not.toContain(sku)
  for (const code of locationCodes) {
    await expect(beta.page.locator(`th[data-location-code="${code}"]`)).toHaveCount(0)
  }
})

test("an edited row saves, is still there when the screen is opened again and shows the Low badge below the threshold", async () => {
  const { page } = alpha
  const location = locationCodes[0]
  await openStock(page)

  // Pick a value that is not already on the row so the unsaved marker appears.
  const current = await inputOf(page, targetSku, location).inputValue()
  const next = current === "7" ? "8" : "7"
  await inputOf(page, targetSku, location).fill(next)
  await expect(rowOf(page, targetSku).getByTestId("stock-unsaved")).toBeVisible()
  await saveRow(page, targetSku)
  await openStock(page)
  await expect(inputOf(page, targetSku, location)).toHaveValue(next)
  await expect(cellOf(page, targetSku, location).getByTestId("stock-low")).toHaveCount(0)

  await inputOf(page, targetSku, location).fill("3")
  await saveRow(page, targetSku)
  await expect(cellOf(page, targetSku, location).getByTestId("stock-low")).toBeVisible()
  await expect(cellOf(page, targetSku, location).getByTestId("stock-low")).toHaveText("Low")
})

test("a value below the reserved number is refused with the reserved number", async ({
  browser,
}, info) => {
  const location = locationCodes[0]
  const { page } = alpha
  const adminSide = await adminSession(browser, info)
  try {
    await openStock(page)
    await inputOf(page, targetSku, location).fill(String(MARKER_QUANTITY))
    await saveRow(page, targetSku)

    const items = await adminSide.request.get(
      `${BACKEND}/admin/inventory-items?limit=200&fields=id,*location_levels`
    )
    expect(items.status()).toBe(200)
    const found = (
      (await items.json()) as {
        inventory_items: {
          id: string
          location_levels: { location_id: string; stocked_quantity: number }[]
        }[]
      }
    ).inventory_items.flatMap((item) =>
      (item.location_levels ?? [])
        .filter((level) => Number(level.stocked_quantity) === MARKER_QUANTITY)
        .map((level) => ({ item: item.id, location: level.location_id }))
    )
    expect(found.length, "exactly one level holds the marker quantity").toBe(1)

    const reserved = await adminSide.request.post(`${BACKEND}/admin/reservations`, {
      data: {
        inventory_item_id: found[0].item,
        location_id: found[0].location,
        quantity: 3,
      },
    })
    expect(reserved.status(), await reserved.text()).toBeLessThan(300)
    reservationId = ((await reserved.json()) as { reservation: { id: string } }).reservation.id
    appendCredentialEntry({
      section: "Vendor portal stock spec",
      what: `Reservation of 3 units on inventory item ${found[0].item}`,
      flow: "vendor-portal-stock.spec.ts, reserved number flow",
      reset:
        "delete the reservation in the Admin or re-create the dev database; the last hook of the spec deletes it",
      values: `reservation ${reservationId}; vendor SKU ${targetSku}`,
    })

    await openStock(page)
    await inputOf(page, targetSku, location).fill("2")
    await rowOf(page, targetSku).getByRole("button", { name: "Save" }).click()
    await expect(cellOf(page, targetSku, location).getByTestId("stock-error")).toHaveText(
      "At least 3 are reserved for orders."
    )
    await openStock(page)
    await expect(inputOf(page, targetSku, location)).toHaveValue(String(MARKER_QUANTITY))

    await inputOf(page, targetSku, location).fill("3")
    await saveRow(page, targetSku)
    await openStock(page)
    await expect(inputOf(page, targetSku, location)).toHaveValue("3")
  } finally {
    await adminSide.context.close()
  }
})

test("the template and the export download with the right content", async () => {
  const { page } = alpha
  await openStock(page)

  const template = await readDownload(page, "Download template", "/vendor/inventory/template")
  expect(template.split(/\r?\n/)[0]).toBe("vendor_sku,location_code,stocked_quantity")

  const exported = await readDownload(page, "Download current stock", "/vendor/inventory/export")
  expect(exported.split(/\r?\n/)[0]).toBe("vendor_sku,location_code,stocked_quantity")
  for (const sku of alphaSkus) expect(exported).toContain(sku)
  for (const code of locationCodes) expect(exported).toContain(code)
  for (const sku of betaSkus) expect(exported).not.toContain(sku)
})

test("an import applies valid rows, reports the others in plain words and refuses bad files", async () => {
  test.setTimeout(180_000)
  const { page } = alpha
  const [first, second] = locationCodes
  await openStock(page)

  const csv = [
    "vendor_sku,location_code,stocked_quantity",
    `${secondSku},${first},12`,
    `${secondSku},${second},9`,
    `NOPE-${RUN},${first},5`,
    `${targetSku},${second},abc`,
    `${targetSku},${first},1`,
    `${secondSku},${first},15`,
  ].join("\n")

  await page.getByTestId("csv-file").setInputFiles({
    name: "stock.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  })
  await expect(page.getByTestId("csv-file-size")).toContainText("stock.csv")
  const upload = page.getByTestId("csv-panel").getByRole("button", { name: "Upload" })
  await expect(upload).toBeEnabled()
  await upload.scrollIntoViewIfNeeded()
  const importReply = page.waitForResponse(
    (response) =>
      response.url().includes("/vendor/inventory/import") && response.request().method() === "POST",
    { timeout: 60_000 }
  )
  await upload.click({ force: true })
  expect((await importReply).status()).toBeLessThan(500)

  await expect(page.getByTestId("csv-applied")).toHaveText("Applied 2", { timeout: 60_000 })
  await expect(page.getByTestId("csv-failed")).toHaveText("Failed 4")
  const problems = page.getByTestId("csv-errors")
  await expect(problems).toContainText("This SKU is not one of your products.")
  await expect(problems).toContainText("Quantity must be a whole number from 0 to 1,000,000.")
  await expect(problems).toContainText("Quantity is below what is already reserved for orders.")
  await expect(problems).toContainText(
    "This SKU and location appear earlier in the file. Only the first row counts."
  )
  await expect(inputOf(page, secondSku, first)).toHaveValue("12")
  await expect(inputOf(page, secondSku, second)).toHaveValue("9")

  appendCredentialEntry({
    section: "Vendor portal stock spec",
    what: `Stock for vendor SKU ${secondSku} set to 12 and 9 by a CSV import`,
    flow: "vendor-portal-stock.spec.ts, csv import flow",
    reset: "set the quantities again in the Stock screen or re-create the dev database",
    values: `locations ${first} and ${second}`,
  })

  await page.getByTestId("csv-file").setInputFiles({
    name: "wrong-header.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("sku,loc,qty\nA,B,1\n"),
  })
  await upload.scrollIntoViewIfNeeded()
  await upload.click({ force: true })
  await expect(
    page.getByText("The first line must be exactly vendor_sku,location_code,stocked_quantity.")
  ).toBeVisible()
  await expect(page.getByText("Nothing was changed.")).toBeVisible()

  await page.getByTestId("csv-file").setInputFiles({
    name: "too-big.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(1_048_577, "a"),
  })
  await expect(page.getByTestId("csv-file-error")).toHaveText(
    "The file is larger than 1 MB. Split it into smaller files."
  )
  await expect(upload).toBeDisabled()
})

test("the stock table scrolls inside its box at 375 px and Save stays reachable", async ({}, info) => {
  const { page } = alpha
  const original = page.viewportSize()
  await page.setViewportSize({ width: 375, height: 812 })
  try {
    await openStock(page)
    const box = page.getByTestId("stock-scroll")
    // The table is wider than the phone; it must scroll inside its box. The page
    // shell uses overflow-x: hidden so the viewport does not pan with the table.
    expect(await box.evaluate((element) => element.clientWidth <= window.innerWidth + 1)).toBe(
      true
    )
    expect(await box.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).overflowX === "hidden")
    ).toBe(true)

    const location = locationCodes[0]
    await inputOf(page, secondSku, location).fill("21")
    const save = rowOf(page, secondSku).getByRole("button", { name: "Save" })
    await box.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeVisible()
    await expect(save).toBeEnabled()
    await page.screenshot({ path: info.outputPath("stock-375.png"), fullPage: true })
  } finally {
    if (original) await page.setViewportSize(original)
  }
})
