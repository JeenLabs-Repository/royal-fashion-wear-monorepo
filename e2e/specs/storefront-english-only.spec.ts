import { expect, test } from "@playwright/test"

// A browser that prefers Hindi must still get the English storefront.
test.use({ extraHTTPHeaders: { "Accept-Language": "hi-IN,hi;q=0.9" } })

test.describe("english only storefront", () => {
  test("the default locale is english", async ({ page }) => {
    await page.goto("/")

    await expect(page).toHaveURL(/\/en$/)
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
  })

  test("a removed language path falls back to english", async ({ page }) => {
    for (const removed of ["/hi", "/ar"]) {
      await page.goto(removed)
      expect(new URL(page.url()).pathname.startsWith("/en/")).toBe(true)
    }
  })

  test("the region dialog offers one country and one language", async ({
    page,
  }) => {
    await page.goto("/en")
    await page.locator('[data-testid="nav-region-select-button"]').click()

    const languages = page.locator('[id^="region-language-"]')
    const countries = page.locator('[id^="region-country-"]')

    await expect(languages).toHaveCount(1)
    await expect(languages).toHaveId("region-language-en")
    await expect(countries).toHaveCount(1)
    await expect(countries).toHaveId("region-country-in")
  })

  test("the head declares one language alternate and the default", async ({
    page,
  }) => {
    await page.goto("/en")

    const alternates = page.locator('head link[rel="alternate"][hreflang]')
    await expect(alternates).toHaveCount(2)

    const languages = await alternates.evaluateAll((links) =>
      links.map((link) => link.getAttribute("hreflang")).sort()
    )
    expect(languages).toEqual(["en", "x-default"])
  })

  test("llms.txt names no removed language", async ({ request }) => {
    const response = await request.get("/llms.txt")

    expect(response.status()).toBe(200)
    const body = await response.text()
    expect(body).not.toContain("Deutsch")
    expect(body).not.toContain("Français")
  })
})
