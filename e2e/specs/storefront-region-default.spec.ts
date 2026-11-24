import { expect, test } from "@playwright/test"

test.describe("storefront region default", () => {
  test("a first visit sets the country cookie to the default region", async ({
    page,
    context,
  }) => {
    await page.goto("/")

    const cookies = await context.cookies()
    const country = cookies.find((cookie) => cookie.name === "_medusa_country")

    expect(country?.value).toBe("in")
  })

  test("the response carries no debug geo headers", async ({ request }) => {
    const response = await request.get("/en")

    expect(response.status()).toBeLessThan(500)
    const names = Object.keys(response.headers())
    expect(names.filter((name) => name.startsWith("x-geo-"))).toEqual([])
  })
})
