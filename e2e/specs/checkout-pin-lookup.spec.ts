import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { appendCredentialEntry } from "../support/credentials-log"

const FLOW = "checkout-pin-lookup"
const backendUrl = process.env.E2E_BACKEND_URL ?? "http://localhost:9000"

function logValues(what: string, values: string) {
  appendCredentialEntry({
    section: "Form values",
    what,
    flow: FLOW,
    reset: "Nothing to reset, the cart expires on its own",
    values,
  })
}

// The publishable key is public by design. Read it from the environment or from
// the storefront's own environment file, so the spec needs no extra setup.
function readPublishableKey(): string {
  const fromEnv = process.env.E2E_PUBLISHABLE_KEY
  if (fromEnv) return fromEnv
  for (const name of [".env.local", ".env"]) {
    try {
      const text = readFileSync(
        path.join(process.cwd(), "apps", "storefront", name),
        "utf8"
      )
      const match = text.match(/^NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=(.+)$/m)
      if (match) return match[1].trim().replace(/^["']|["']$/g, "")
    } catch {
      // try the next file
    }
  }
  throw new Error(
    "Set E2E_PUBLISHABLE_KEY or put the storefront publishable key in apps/storefront/.env.local."
  )
}

async function openAddressSheet(page: Page) {
  test.setTimeout(120_000)

  await page.goto("/en/products/t-shirt")

  // A product with options needs one value per option before it can be added.
  const groups = page
    .getByTestId("product-container")
    .getByTestId("product-options")
  const groupCount = await groups.count()
  for (let index = 0; index < groupCount; index += 1) {
    await groups.nth(index).getByTestId("option-button").first().click()
  }

  const addButton = page
    .getByTestId("product-container")
    .getByTestId("add-product-button")
    .and(page.locator(":enabled"))
  await expect(addButton).toBeVisible()
  await addButton.click()
  await expect(page.getByTestId("cart-item-count").first()).toHaveText(
    /[1-9]/,
    { timeout: 20_000 }
  )

  // The add runs as a server action; reload the cart until the item is there.
  await expect(async () => {
    await page.goto("/en/cart")
    await expect(page.getByTestId("checkout-button")).toBeVisible({
      timeout: 2000,
    })
  }).toPass({ timeout: 20000 })

  await page.getByTestId("checkout-button").click()
  await page.getByTestId("checkout-address-row").click()
  await expect(page.getByTestId("shipping-pin-input")).toBeVisible()
}

test.describe("checkout PIN lookup", () => {
  test("a known PIN fills state and city and saves", async ({ page }) => {
    await openAddressSheet(page)
    logValues("Known PIN", "pin 400001, street 12 Test Lane")

    await page.getByTestId("shipping-pin-input").fill("400001")
    await expect(page.getByTestId("shipping-state-select")).toHaveValue(
      "in-mh",
      { timeout: 3000 }
    )
    await expect(page.getByTestId("shipping-city-input")).not.toHaveValue("")
    await expect(page.getByTestId("pin-hint")).toBeVisible()

    await page.getByTestId("shipping-address-input").fill("12 Test Lane")
    await page.getByTestId("shipping-address-save").click()

    await expect(page.getByTestId("shipping-pin-input")).toBeHidden()
  })

  test("an unknown PIN does not block and the address is flagged", async ({
    page,
  }) => {
    await openAddressSheet(page)
    // 999998 is absent from the bundled directory (999999 is a real Telangana PIN).
    logValues("Unknown PIN", "pin 999998, state Maharashtra, city Testville")

    await page.getByTestId("shipping-pin-input").fill("999998")
    await expect(page.getByTestId("pin-hint")).toContainText("could not verify")

    await page.getByTestId("shipping-state-select").selectOption("in-mh")
    await page.getByTestId("shipping-city-input").fill("Testville")
    await page.getByTestId("shipping-address-input").fill("12 Test Lane")
    await page.getByTestId("shipping-address-save").click()

    await expect(page.getByTestId("shipping-pin-input")).toBeHidden()

    const cookies = await page.context().cookies()
    const cartId = cookies.find((cookie) => cookie.name === "_medusa_cart_id")
      ?.value
    expect(cartId).toBeTruthy()

    const response = await page.request.get(
      `${backendUrl}/store/carts/${cartId}`,
      {
        params: { fields: "*shipping_address" },
        headers: { "x-publishable-api-key": readPublishableKey() },
      }
    )
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body.cart.shipping_address.metadata?.pin_unverified).toBe(true)
  })

  test("a known PIN with another state is rejected by the server", async ({
    page,
  }) => {
    await openAddressSheet(page)
    logValues("PIN and state mismatch", "pin 400001, state Karnataka")

    await page.getByTestId("shipping-pin-input").fill("400001")
    await expect(page.getByTestId("shipping-state-select")).toHaveValue(
      "in-mh",
      { timeout: 3000 }
    )

    // Choosing another state afterwards shows the warning and still lets the
    // customer submit; the server makes the final call.
    await page.getByTestId("shipping-state-select").selectOption("in-ka")
    await expect(page.getByTestId("pin-hint")).toContainText("Maharashtra")

    await page.getByTestId("shipping-address-input").fill("12 Test Lane")
    await page.getByTestId("shipping-address-save").click()

    await expect(page.getByTestId("shipping-address-error")).toContainText(
      "another state"
    )
    await expect(page.getByTestId("shipping-pin-input")).toBeVisible()
  })
})
