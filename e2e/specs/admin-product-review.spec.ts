import { deflateSync } from "node:zlib"
import { type APIRequestContext, type Browser, type Page, expect, test } from "@playwright/test"
import { defaultTarget, loginAsDemo, signOut } from "../support/admin-login"
import { appendCredentialEntry } from "../support/credentials-log"
import { signInFreshVendor } from "../helpers/vendor-flow"

// Precondition. The dev stack runs with the demo seeds applied and the demo
// staff users exist. Every flow that consumes a product creates its own
// through the vendor API, so the flows can run in any order.

test.describe.configure({ mode: "serial" })

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The Admin dashboard is not a phone interface, so these flows run on the desktop project only"
  )
})

const { adminUrl } = defaultTarget()
const BACKEND = process.env.E2E_BACKEND_URL ?? "http://localhost:9000"
const PUBLISHABLE_KEY = process.env.E2E_PUBLISHABLE_KEY ?? ""
const RUN = Date.now()

const STALE_TEXT =
  "This item changed after you opened it. Reload to see the latest version, then check the list again."
const LABELS = [
  "check-no_identifying_text",
  "check-no_watermark_or_logo",
  "check-images_checked",
  "check-declarations_reviewed",
  "check-gst_and_hsn_set",
  "check-selling_price_set",
]

// The Authorization header the portal sends; a vendor token is never a cookie.
let vendorAuth: Record<string, string> = {}
let categoryId = ""
let counter = 0

// A 16 by 16 PNG built at run time, so no binary file is committed.
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

const vendorRequest = async (browser: Browser) => {
  const context = await browser.newContext({ extraHTTPHeaders: vendorAuth })
  return { context, request: context.request }
}

const uploadImage = async (request: APIRequestContext, shade: number): Promise<string> => {
  const response = await request.post(`${BACKEND}/vendor/uploads`, {
    multipart: {
      file: { name: `spec-${shade}.png`, mimeType: "image/png", buffer: makePng(shade, 60, 90) },
    },
  })
  expect(response.status(), await response.text()).toBeLessThan(300)
  return ((await response.json()) as { upload: { id: string } }).upload.id
}

type Made = { productId: string; title: string; skuS: string; skuM: string }

// Creates and submits one product as the vendor. `variants` lets a flow change the MRP.
const submitProduct = async (
  browser: Browser,
  options: { mrp?: string; images?: number } = {}
): Promise<Made> => {
  counter += 1
  const tag = `${RUN}-${counter}`
  const title = `Spec Review Shirt ${tag}`
  const skuS = `RV-${tag}-S`
  const skuM = `RV-${tag}-M`
  const { context, request } = await vendorRequest(browser)
  try {
    const uploads: string[] = []
    for (let i = 0; i < (options.images ?? 2); i++) {
      uploads.push(await uploadImage(request, 40 + i * 70))
    }
    const mrp = options.mrp ?? "299.00"
    const body = {
      title,
      description: "Soft cotton shirt.\nMachine washable.",
      images: uploads.map((upload_id) => ({ upload_id })),
      options: [{ title: "Size", values: ["S", "M"] }],
      variants: [
        {
          vendor_sku: skuS,
          option_values: { Size: "S" },
          payout_price: "199.99",
          mrp,
          net_quantity_value: 1,
          net_quantity_unit: "pcs",
          weight_g: 250,
        },
        {
          vendor_sku: skuM,
          option_values: { Size: "M" },
          payout_price: "209.50",
          mrp,
          net_quantity_value: 1,
          net_quantity_unit: "pcs",
          weight_g: 260,
        },
      ],
      proposed_category_id: categoryId,
      proposed_gst_class: "GST-5",
      proposed_hsn: "6109",
      declaration: {
        generic_name: "Cotton shirt",
        country_of_origin: "IN",
        packed_by_name: "Spec Packers",
        packed_by_address: "1 Spec Road, Mumbai 400001",
      },
    }
    const created = await request.post(`${BACKEND}/vendor/products`, { data: body })
    expect(created.status(), await created.text()).toBe(201)
    const productId = ((await created.json()) as { product: { id: string } }).product.id
    const submitted = await request.post(`${BACKEND}/vendor/products/${productId}/submit`, {
      data: {},
    })
    expect(submitted.status(), await submitted.text()).toBeLessThan(300)
    appendCredentialEntry({
      section: "Form values",
      what: `Demo review product ${title}`,
      flow: "admin-product-review.spec.ts",
      reset: "reject it in Product reviews or drop the dev database",
      values: `product ${productId}, vendor SKUs ${skuS} and ${skuM}`,
    })
    return { productId, title, skuS, skuM }
  } finally {
    await context.close()
  }
}

const reviewIdFor = async (page: Page, title: string, tab = "New"): Promise<string> => {
  await page.goto(`${adminUrl}/product-reviews`)
  await page.getByRole("tab", { name: tab }).click()
  const row = page.getByRole("row", { name: new RegExp(title) })
  await expect(row).toBeVisible()
  await row.getByRole("link", { name: "Open" }).click()
  await expect(page.getByTestId("review-title")).toHaveText(title)
  return new URL(page.url()).pathname.split("/").pop() as string
}

const tickAll = async (page: Page) => {
  for (const id of LABELS) await page.getByTestId(id).click()
}

const pickOption = async (page: Page, testId: string, name: string | RegExp) => {
  await page.getByTestId(testId).click()
  await page.getByRole("option", { name }).first().click()
}

const fillPrices = async (page: Page, made: Made, price = "249.00") => {
  await page.getByTestId(`price-${made.skuS}`).fill(price)
  await page.getByTestId(`price-${made.skuM}`).fill(price)
}

const ensureHsn = async (page: Page, value = "6109") => {
  const field = page.getByTestId("hsn-input")
  if ((await field.inputValue()) === "") {
    await field.fill(value)
  }
}

const fillApproval = async (page: Page, made: Made, price = "249.00") => {
  await tickAll(page)
  await fillPrices(page, made, price)
  await pickOption(page, "gst-select", "GST-5")
  await ensureHsn(page)
  if ((await page.getByTestId("category-select").innerText()).includes("Choose")) {
    await pickOption(page, "category-select", /.+/)
  }
}

const storeProduct = async (request: APIRequestContext, productId: string) => {
  const response = await request.get(`${BACKEND}/store/products`, {
    headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
    params: { id: productId, fields: "id,title,handle,*variants,+variants.sku" },
  })
  expect(response.status()).toBe(200)
  return (
    (await response.json()) as {
      products: { id: string; title: string; handle: string; variants: { sku: string }[] }[]
    }
  ).products[0]
}

// Rebuild a full vendor content body from a GET detail so updates stay schema-valid.
const contentBodyFromDetail = (
  product: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) => {
  const content = product.content as Record<string, unknown>
  const images = (content.images as { upload_id: string }[]).map(({ upload_id }) => ({
    upload_id,
  }))
  return { ...content, images, ...overrides }
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(240_000)
  if (info.project.name !== "chromium") return
  expect(
    PUBLISHABLE_KEY,
    "Set E2E_PUBLISHABLE_KEY to a publishable key linked to the default sales channel"
  ).not.toBe("")
  const context = await browser.newContext()
  const page = await context.newPage()
  let bearer = ""
  page.on("request", async (outgoing) => {
    const header = (await outgoing.allHeaders()).authorization
    if (header?.startsWith("Bearer ")) bearer = header
  })
  await signInFreshVendor(page, { status: "active" })
  await expect
    .poll(() => bearer, { message: "The portal sent no Authorization header" })
    .not.toBe("")
  vendorAuth = { authorization: bearer }
  const categories = await context.request.get(`${BACKEND}/vendor/categories`, {
    headers: vendorAuth,
  })
  expect(categories.status()).toBe(200)
  const list = ((await categories.json()) as { categories: { id: string }[] }).categories
  expect(list.length, "Seed at least one product category").toBeGreaterThan(0)
  categoryId = list[0].id
  await context.close()
})

test("the queue lists new products, live edits and changes requested", async ({
  page,
  browser,
}) => {
  const made = await submitProduct(browser)
  await loginAsDemo(page, "catalog_approver")
  await page.goto(`${adminUrl}/product-reviews`)
  await expect(page.getByRole("heading", { name: "Product reviews" })).toBeVisible()
  await expect(page.getByRole("row", { name: new RegExp(made.title) })).toBeVisible()

  await page.getByRole("tab", { name: "Live edits" }).click()
  await expect(
    page.getByTestId("review-row").or(page.getByText("Nothing is waiting here."))
  ).not.toHaveCount(0)
  await expect(page.getByRole("row", { name: /Demo .*/ }).first()).toBeVisible()

  await page.getByRole("tab", { name: "Changes requested" }).click()
  await expect(
    page.getByTestId("review-row").or(page.getByText("Nothing is waiting here."))
  ).not.toHaveCount(0)
})

test("approve stays disabled until every rule is met", async ({ page, browser }) => {
  const made = await submitProduct(browser, { mrp: "299.00" })
  await loginAsDemo(page, "catalog_approver")
  await reviewIdFor(page, made.title)
  const approve = page.getByTestId("approve")
  await expect(approve).toBeDisabled()

  await tickAll(page)
  await expect(approve).toBeDisabled()

  await fillPrices(page, made, "300.00")
  await expect(
    page.getByRole("alert").filter({ hasText: "cannot be higher than the MRP" }).first()
  ).toBeVisible()
  await expect(approve).toBeDisabled()

  await fillPrices(page, made, "249.00")
  await pickOption(page, "gst-select", "GST-5")
  // proposed_hsn can be missing from the rebuilt live snapshot; fill when empty.
  await ensureHsn(page)
  await expect(page.getByTestId("hsn-input")).toHaveValue("6109")
  if ((await page.getByTestId("category-select").innerText()).includes("Choose")) {
    await pickOption(page, "category-select", /.+/)
  }
  await expect(approve).toBeEnabled()

  await page.getByTestId("reject").click()
  await page.getByTestId("reason-input").fill("too short")
  await expect(page.getByTestId("reason-confirm")).toBeDisabled()
  await page.getByTestId("reason-input").fill("This reason is long enough.")
  await expect(page.getByTestId("reason-confirm")).toBeEnabled()
})

test("approving puts the product on the Store API with platform identifiers only", async ({
  page,
  browser,
}) => {
  const made = await submitProduct(browser)
  await loginAsDemo(page, "catalog_approver")
  await reviewIdFor(page, made.title)
  await fillApproval(page, made)
  await page.getByTestId("approve").click()
  await expect(page.getByText("Product approved")).toBeVisible()
  await expect(page).toHaveURL(/\/product-reviews$/)
  await expect(page.getByRole("row", { name: new RegExp(made.title) })).toHaveCount(0)

  await expect
    .poll(async () => (await storeProduct(page.request, made.productId))?.handle ?? "", {
      timeout: 15_000,
    })
    .toMatch(/-[a-z2-7]{5}$/)
  const live = await storeProduct(page.request, made.productId)
  expect(live.variants.length).toBe(2)
  for (const variant of live.variants) expect(variant.sku).toMatch(/^PL-\d{8}$/)
  const text = JSON.stringify(live)
  expect(text).not.toContain(made.skuS)
  expect(text).not.toContain(made.skuM)
})

test("a stale approval shows the reload prompt and unticks the checklist", async ({
  page,
  browser,
}) => {
  const made = await submitProduct(browser)
  await loginAsDemo(page, "catalog_approver")
  await reviewIdFor(page, made.title)
  await fillApproval(page, made)
  await expect(page.getByTestId("approve")).toBeEnabled()

  // The vendor changes the submission after the page loaded: withdraw, edit, submit again.
  const { context, request } = await vendorRequest(browser)
  try {
    const newTitle = `${made.title} edited`
    const withdrawn = await request.post(`${BACKEND}/vendor/products/${made.productId}/withdraw`, {
      data: {},
    })
    expect(withdrawn.status(), await withdrawn.text()).toBeLessThan(300)
    const current = await request.get(`${BACKEND}/vendor/products/${made.productId}`)
    const product = ((await current.json()) as { product: Record<string, unknown> }).product
    const updated = await request.post(`${BACKEND}/vendor/products/${made.productId}`, {
      data: contentBodyFromDetail(product, { title: newTitle }),
    })
    expect(updated.status(), await updated.text()).toBeLessThan(300)
    const resubmitted = await request.post(`${BACKEND}/vendor/products/${made.productId}/submit`, {
      data: {},
    })
    expect(resubmitted.status(), await resubmitted.text()).toBeLessThan(300)

    await page.getByTestId("approve").click()
    await expect(page.getByTestId("stale-prompt")).toContainText(STALE_TEXT)
    await expect(page.getByTestId("check-images_checked")).not.toBeChecked()
    await page.getByRole("button", { name: "Reload" }).click()
    await expect(page.getByTestId("review-title")).toHaveText(newTitle)
  } finally {
    await context.close()
  }
})

test("request changes and reject each move the item to their tab", async ({ page, browser }) => {
  const asked = await submitProduct(browser)
  const refused = await submitProduct(browser)
  await loginAsDemo(page, "catalog_approver")

  await reviewIdFor(page, asked.title)
  await page.getByTestId("request-changes").click()
  await page.getByTestId("reason-input").fill("Please remove the logo.")
  await page.getByTestId("reason-confirm").click()
  await page.goto(`${adminUrl}/product-reviews`)
  await page.getByRole("tab", { name: "Changes requested" }).click()
  await expect(page.getByRole("row", { name: new RegExp(asked.title) })).toBeVisible()

  await reviewIdFor(page, refused.title)
  await page.getByTestId("reject").click()
  await page.getByTestId("reason-input").fill("This product is not suitable.")
  await page.getByTestId("reason-confirm").click()
  await page.goto(`${adminUrl}/product-reviews`)
  await page.getByRole("tab", { name: "Rejected" }).click()
  await expect(page.getByRole("row", { name: new RegExp(refused.title) })).toBeVisible()
})

test("a live edit shows the title change and applying it keeps handle and SKUs", async ({
  page,
  browser,
}) => {
  // First approve a product, then change its title as the vendor.
  const made = await submitProduct(browser)
  await loginAsDemo(page, "catalog_approver")
  await reviewIdFor(page, made.title)
  await fillApproval(page, made)
  await page.getByTestId("approve").click()
  await expect(page.getByText("Product approved")).toBeVisible()
  await expect
    .poll(async () => (await storeProduct(page.request, made.productId))?.handle ?? "", {
      timeout: 15_000,
    })
    .not.toBe("")
  const before = await storeProduct(page.request, made.productId)

  const newTitle = `${made.title} v2`
  const { context, request } = await vendorRequest(browser)
  try {
    const current = await request.get(`${BACKEND}/vendor/products/${made.productId}`)
    const product = ((await current.json()) as { product: Record<string, unknown> }).product
    // Live updates mark the submission submitted themselves; do not call /submit again.
    const edited = await request.post(`${BACKEND}/vendor/products/${made.productId}`, {
      data: contentBodyFromDetail(product, { title: newTitle }),
    })
    expect(edited.status(), await edited.text()).toBeLessThan(300)
  } finally {
    await context.close()
  }

  await reviewIdFor(page, newTitle, "Live edits")
  await expect(page.getByTestId("diff-view")).toBeVisible()
  await expect(page.getByTestId("diff-before-title")).toContainText(made.title)
  await expect(page.getByTestId("diff-after-title")).toContainText(newTitle)
  // Live prices and proposed classification may already be present; fill anything still blank.
  await fillApproval(page, made)
  await expect(page.getByTestId("approve")).toBeEnabled()
  await page.getByTestId("approve").click()
  await expect(page.getByText("Product approved")).toBeVisible()

  await expect
    .poll(async () => (await storeProduct(page.request, made.productId))?.title, {
      timeout: 15_000,
    })
    .toBe(newTitle)
  const after = await storeProduct(page.request, made.productId)
  expect(after.handle).toBe(before.handle)
  expect(after.variants.map((v) => v.sku).sort()).toEqual(
    before.variants.map((v) => v.sku).sort()
  )
})

test("approver edits are saved as plain text and refresh the revision", async ({
  page,
  browser,
}) => {
  const made = await submitProduct(browser)
  await loginAsDemo(page, "catalog_approver")
  await reviewIdFor(page, made.title)

  await page.getByTestId("edit-title").fill(`<b>${made.title}</b> edited`)
  await page.getByTestId("save-edits").click()
  await expect(page.getByText("Edits saved")).toBeVisible()
  await expect(page.getByTestId("review-title")).toHaveText(`${made.title} edited`)
  await expect(page.getByTestId("review-title")).not.toContainText("<")

  // The page now holds the new hash, so an approval is of the edited content and the checklist starts empty.
  await expect(page.getByTestId("check-images_checked")).not.toBeChecked()
  await expect(page.getByTestId("approve")).toBeDisabled()
})

test("roles that may not decide see disabled controls or no access", async ({
  page,
  browser,
}) => {
  const made = await submitProduct(browser)

  await signOut(page)
  await loginAsDemo(page, "support")
  await page.goto(`${adminUrl}/product-reviews`)
  await expect(page.getByText("You do not have access to product reviews.")).toBeVisible()

  await signOut(page)
  await loginAsDemo(page, "finance_readonly")
  await page.goto(`${adminUrl}/product-reviews`)
  await expect(page.getByRole("row", { name: new RegExp(made.title) })).toBeVisible()
  await page
    .getByRole("row", { name: new RegExp(made.title) })
    .getByRole("link", { name: "Open" })
    .click()
  await expect(page.getByTestId("review-title")).toHaveText(made.title)
  await expect(page.getByTestId("approve")).toBeDisabled()
  await expect(page.getByTestId("reject")).toBeDisabled()
  await expect(page.getByTestId("request-changes")).toBeDisabled()
  await expect(page.getByTestId("content-editor")).toHaveCount(0)
})
