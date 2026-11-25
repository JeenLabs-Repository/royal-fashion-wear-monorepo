import { expect, test } from "@playwright/test"
import { portalUrl, signIn, signInFreshVendor } from "../helpers/vendor-flow"

// Precondition. Backend running, demo vendor seed applied, portal origin in the
// backend auth CORS setting.

test("a fresh vendor completes onboarding in the portal", async ({ page }) => {
  test.setTimeout(180_000)
  const vendor = await signInFreshVendor(page)

  // Home: the agreement step is open and the banner says what to do.
  await expect(page.getByTestId("onboarding-step-agreement")).toContainText("Incomplete")
  await expect(page.getByTestId("status-banner")).toContainText("Complete the steps below.")

  // Agreement: both documents render as text, never as script or image elements.
  await page.getByRole("link", { name: "Agreement", exact: true }).click()
  for (const id of ["agreement-doc-agreement", "agreement-doc-packing-guideline"]) {
    const document = page.getByTestId(id)
    await expect(document).toBeVisible()
    await expect(document.locator("script, img")).toHaveCount(0)
  }
  await expect(page.getByTestId("agreement-accept-button")).toBeDisabled()
  await page.getByTestId("agreement-accept-checkbox").click()
  await expect(page.getByTestId("agreement-accept-button")).toBeEnabled()
  await page.getByTestId("agreement-accept-button").click()

  // Back on home: the step is complete and the banner changed.
  await expect(page.getByTestId("screen-home")).toBeVisible()
  await expect(page.getByTestId("onboarding-step-agreement")).toContainText("Complete")
  await expect(page.getByTestId("status-banner")).toContainText("Everything is done on your side.")

  // Locations: two rows, read only, with the note.
  await page.getByRole("link", { name: "Locations", exact: true }).click()
  await expect(page.getByTestId("locations-note")).toHaveText(
    "Locations are managed by the store. To change one, contact the store team."
  )
  await expect(page.locator('[data-testid^="location-row-"]')).toHaveCount(2)
  await expect(page.getByRole("button", { name: /edit|save|delete/i })).toHaveCount(0)

  // Profile: account data and a password change.
  await page.getByRole("link", { name: "Profile", exact: true }).click()
  await expect(page.getByTestId("profile-account")).toContainText(vendor.email)
  const newPassword = `Changed-${Date.now()}-Passw0rd`
  await page.getByTestId("password-current").fill(vendor.password)
  await page.getByTestId("password-new").fill(newPassword)
  await page.getByTestId("password-confirm").fill(newPassword)
  await page.getByTestId("password-submit").click()
  await expect(page.getByTestId("password-success")).toBeVisible()

  // Sign in again with the new password and a fresh code.
  await page.getByTestId("sign-out").click()
  await expect(page).toHaveURL(/\/login$/)
  await signIn(page, { ...vendor, password: newPassword })
})

test("an active fresh vendor sees the active banner", async ({ page }) => {
  test.setTimeout(120_000)
  await signInFreshVendor(page, { status: "active" })
  await expect(page.getByTestId("onboarding-step-agreement")).toContainText("Complete")
  await expect(page.getByTestId("status-banner")).toContainText("Your account is active.")
  await page.getByRole("link", { name: "Agreement", exact: true }).click()
  await expect(page.getByTestId("agreement-accepted")).toBeVisible()
  await expect(page.getByTestId("agreement-accept-button")).toHaveCount(0)
})
