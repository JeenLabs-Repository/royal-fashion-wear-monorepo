import { type Page, expect, test } from "@playwright/test"
import { navigateInApp, portalUrl } from "../helpers/vendor-flow"
import { readDemoVendorCredentials } from "../helpers/vendor-seed"

// Precondition. The demo vendor seed has run, so the vendor under the key `delta`
// (Demo Vendor Delta) exists and is suspended.
const SUSPENDED_KEY = "delta"

const signInSuspended = async (page: Page) => {
  const { email, password } = readDemoVendorCredentials(SUSPENDED_KEY)
  await page.goto(`${portalUrl}/login`)
  await page.getByTestId("login-email").fill(email)
  await page.getByTestId("login-password").fill(password)
  await page.getByTestId("login-submit").click()
}

test("a suspended vendor sees the suspended screen after signing in", async ({ page }) => {
  await signInSuspended(page)
  await expect(page.getByTestId("suspended-screen")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("suspended-screen")).toContainText("Your account is suspended")
})

test("navigation keeps the suspended screen and sign-out works", async ({ page }) => {
  await signInSuspended(page)
  await expect(page.getByTestId("suspended-screen")).toBeVisible({ timeout: 20_000 })

  for (const route of ["/", "/agreement", "/locations", "/profile", "/mfa"]) {
    await navigateInApp(page, route)
    await expect(page.getByTestId("suspended-screen")).toBeVisible()
  }

  await page.getByTestId("sign-out").click()
  await expect(page).toHaveURL(/\/login$/)
})
