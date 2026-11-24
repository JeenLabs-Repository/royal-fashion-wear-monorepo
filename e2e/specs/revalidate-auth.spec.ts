import { expect, test } from "@playwright/test"

// The endpoint the backend calls to flush storefront caches. It must reject
// anything without the shared secret and must not crash on a bad body.
// E2E_REVALIDATE_SECRET has to match REVALIDATE_SECRET of the storefront under
// test; the success cases are skipped when it is not provided.

const secret = process.env.E2E_REVALIDATE_SECRET

test.describe("revalidate endpoint", () => {
  test("rejects a request without the secret with 401", async ({ request }) => {
    const response = await request.post("/api/revalidate", {
      data: { type: "noop" },
    })
    expect(response.status()).toBe(401)
  })

  test("rejects a wrong secret with 401", async ({ request }) => {
    const response = await request.post("/api/revalidate", {
      headers: { "x-revalidate-secret": "not-the-secret" },
      data: { type: "noop" },
    })
    expect(response.status()).toBe(401)
  })

  test("accepts the correct secret with 200", async ({ request }) => {
    test.skip(!secret, "Set E2E_REVALIDATE_SECRET to the storefront's REVALIDATE_SECRET to run this case")
    const response = await request.post("/api/revalidate", {
      headers: { "x-revalidate-secret": secret as string },
      data: { type: "noop" },
    })
    expect(response.status()).toBe(200)
  })

  test("answers 400 to a body that is not JSON", async ({ request }) => {
    test.skip(!secret, "Set E2E_REVALIDATE_SECRET to the storefront's REVALIDATE_SECRET to run this case")
    const response = await request.post("/api/revalidate", {
      headers: {
        "x-revalidate-secret": secret as string,
        "content-type": "application/json",
      },
      data: "this is not json",
    })
    expect(response.status()).toBe(400)
  })
})
