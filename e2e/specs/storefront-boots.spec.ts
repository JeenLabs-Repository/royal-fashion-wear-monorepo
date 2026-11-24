import { expect, test } from "@playwright/test"

const backendUrl = process.env.E2E_BACKEND_URL ?? "http://localhost:9000"

test("storefront redirects to the default locale", async ({ page }, testInfo) => {
  await page.goto("/")

  await expect(page).toHaveURL(/\/en\/?$/)
  await expect(page.locator("html")).toHaveAttribute("lang", "en")

  if (testInfo.project.name === "chromium-mobile") {
    // The store link is hidden below the large breakpoint, so check the menu control.
    await expect(page.locator("body")).toBeVisible()
    await expect(page.locator('[data-testid="nav-menu-button"]')).toBeVisible()
  } else {
    await expect(page.locator('[data-testid="nav-store-link"]')).toBeVisible()
  }
})

test("backend health endpoint answers", async ({ request }) => {
  const response = await request.get(`${backendUrl}/health`)
  expect(response.status()).toBe(200)
})
