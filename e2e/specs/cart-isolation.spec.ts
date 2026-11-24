import { randomBytes } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { appendCredentialEntry } from "../support/credentials-log"

// One customer's cart, profile and addresses must never be shown to another
// customer or to a signed-out visitor. Three separate browser contexts stand in
// for three people at three machines.

const stamp = Date.now()
const password = `Pw-${randomBytes(9).toString("base64url")}-9a`

const customers = {
  a: {
    first: "E2E",
    last: "Customer A",
    email: `e2e-a-${stamp}@example.test`,
    phone: "+919000000011",
  },
  b: {
    first: "E2E",
    last: "Customer B",
    email: `e2e-b-${stamp}@example.test`,
    phone: "+919000000012",
  },
}

type Customer = (typeof customers)["a"]

const register = async (page: Page, customer: Customer) => {
  await page.goto("/en/account")
  await page.getByTestId("login-page").getByTestId("register-button").click()
  const form = page.getByTestId("register-page")
  await expect(form).toBeVisible()
  await form.getByTestId("first-name-input").fill(customer.first)
  await form.getByTestId("last-name-input").fill(customer.last)
  await form.getByTestId("email-input").fill(customer.email)
  await form.getByTestId("phone-input").fill(customer.phone)
  await form.getByTestId("password-input").fill(password)
  await form.getByTestId("register-button").click()
  // The dashboard replaces the sign-in views once the account exists.
  await expect(page.getByTestId("register-page")).toHaveCount(0)
  await expect(page.getByTestId("login-page")).toHaveCount(0)
}

const profileEmail = async (page: Page) => {
  await page.goto("/en/account/profile")
  const editor = page.getByTestId("account-email-editor")
  await expect(editor).toBeVisible()
  return editor.getByTestId("current-info").innerText()
}

const addFirstAvailableVariantToCart = async (page: Page) => {
  await page.goto("/en/products/t-shirt")
  // The button stays disabled until every option has a value, so pick the
  // first value of each option group. Scope to the product panel so related
  // products and the mobile sheet are ignored.
  const groups = page
    .getByTestId("product-container")
    .getByTestId("product-options")
  const groupCount = await groups.count()
  for (let index = 0; index < groupCount; index += 1) {
    await groups.nth(index).getByTestId("option-button").first().click()
  }

  // Suspense can briefly keep a disabled fallback button; click the enabled one.
  const addButton = page
    .getByTestId("product-container")
    .getByTestId("add-product-button")
    .and(page.locator(":enabled"))
  await expect(addButton).toBeVisible()
  await addButton.click()
  // click() does not wait for the async server action; leaving the page early
  // aborts the add. Wait for a nav badge (header and bottom nav both render one).
  await expect(page.getByTestId("cart-item-count").first()).toHaveText(
    /[1-9]/,
    { timeout: 20_000 }
  )
}

const openCartWithItem = async (page: Page) => {
  // The add-to-cart action finishes in the background, so reload the cart page
  // until the line item shows up.
  await expect(async () => {
    await page.goto("/en/cart")
    await expect(
      page.getByTestId("items-table").getByTestId("product-title").first()
    ).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  return page
    .getByTestId("items-table")
    .getByTestId("product-title")
    .first()
    .innerText()
}

test("a customer's cart and profile are never shown to another visitor", async ({
  browser,
}) => {
  // Two registrations, a product add, and three contexts need more than the
  // default 30s, especially on a cold Next.js page compile.
  test.setTimeout(120_000)

  // New contexts do not inherit the project's settings, so pass the ones that
  // matter (base URL and the device profile of the mobile project).
  const { baseURL, viewport, userAgent, isMobile, hasTouch } =
    test.info().project.use
  const contextOptions = { baseURL, viewport, userAgent, isMobile, hasTouch }

  const contextA = await browser.newContext(contextOptions)
  const contextB = await browser.newContext(contextOptions)
  const contextVisitor = await browser.newContext(contextOptions)

  try {
    const pageA = await contextA.newPage()
    await register(pageA, customers.a)
    await appendCredentialEntry({
      section: "Accounts by role",
      what: `customer ${customers.a.email}`,
      flow: "cart-isolation",
      reset: "Delete the customer in Admin or recreate the database",
      values: `email ${customers.a.email}, password ${password}`,
    })

    // Customer A warms every per-customer request: profile first, then a cart.
    expect(await profileEmail(pageA)).toBe(customers.a.email)
    await addFirstAvailableVariantToCart(pageA)
    const titleA = await openCartWithItem(pageA)
    expect(titleA.length).toBeGreaterThan(0)

    // Customer B, in a separate browser context, sees none of it.
    const pageB = await contextB.newPage()
    await register(pageB, customers.b)
    await appendCredentialEntry({
      section: "Accounts by role",
      what: `customer ${customers.b.email}`,
      flow: "cart-isolation",
      reset: "Delete the customer in Admin or recreate the database",
      values: `email ${customers.b.email}, password ${password}`,
    })

    expect(await profileEmail(pageB)).toBe(customers.b.email)

    await pageB.goto("/en/cart")
    await expect(pageB.getByTestId("empty-cart-message")).toBeVisible()
    await expect(pageB.getByTestId("items-table")).toHaveCount(0)
    await expect(pageB.getByTestId("cart-container")).not.toContainText(titleA)

    // A signed-out visitor sees an empty cart and the sign-in form, and nothing
    // that belongs to A or B.
    const pageVisitor = await contextVisitor.newPage()
    await pageVisitor.goto("/en/cart")
    await expect(pageVisitor.getByTestId("empty-cart-message")).toBeVisible()
    await expect(pageVisitor.getByTestId("items-table")).toHaveCount(0)

    await pageVisitor.goto("/en/account")
    await expect(pageVisitor.getByTestId("login-page")).toBeVisible()
    await expect(pageVisitor.locator("body")).not.toContainText(customers.a.email)
    await expect(pageVisitor.locator("body")).not.toContainText(customers.b.email)
  } finally {
    await contextA.close()
    await contextB.close()
    await contextVisitor.close()
  }
})
