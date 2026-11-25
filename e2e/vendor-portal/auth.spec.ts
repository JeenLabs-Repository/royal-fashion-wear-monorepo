import { type Page, expect, test } from "@playwright/test"
import { freshTotp } from "../helpers/totp"
import { seedFreshVendor } from "../helpers/vendor-seed"
import { appendCredentialEntry } from "../support/credentials-log"

// Precondition. The backend must be running with `pnpm backend:dev`, the demo
// staff and vendor seeds must have run, and the vendors origin
// (http://localhost:5173) must be listed in the backend auth CORS setting.
// The portal lives under the /vendor-portal base path; set E2E_PORTAL_URL to
// http://localhost:9000/vendor-portal to run against the backend-served build.
const portal = process.env.E2E_PORTAL_URL ?? "http://localhost:5173/vendor-portal"
const portalOrigin = new URL(portal).origin
// Path inside the portal, without the base path.
const inPortal = (url: URL): string => url.pathname.replace(/^\/vendor-portal/, "") || "/"

const signIn = async (
  page: Page,
  input: { email: string; password: string; secret: string; usedStep?: number }
): Promise<number> => {
  await page.goto(`${portal}/login`)
  await page.getByTestId("login-email").fill(input.email)
  await page.getByTestId("login-password").fill(input.password)
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("login-code")).toBeVisible()
  const { code, step } = await freshTotp(input.secret, input.usedStep)
  await page.getByTestId("login-code").fill(code)
  await page.getByTestId("login-code-submit").click()
  await expect(page.getByTestId("screen-home")).toBeVisible()
  return step
}

test("an invited vendor accepts the link, signs in and enrols two-factor sign-in", async ({
  page,
}) => {
  // Enrolment plus a possible wait for the next TOTP window can exceed 30s.
  test.setTimeout(120_000)
  const invite = seedFreshVendor()
  const link = new URL(invite.inviteLink)
  const password = `Spec-${Date.now()}-Passw0rd`

  // The invitation link already carries the /vendor-portal base path.
  await page.goto(`${portalOrigin}${link.pathname}${link.hash}`)
  await expect(page.getByTestId("accept-form")).toBeVisible()
  // The token is gone from the address bar and from the history entry.
  expect(page.url()).not.toContain("token")
  expect(await page.evaluate(() => window.location.hash)).toBe("")

  await page.getByTestId("accept-password").fill(password)
  await page.getByTestId("accept-confirm").fill(password)
  await page.getByTestId("accept-submit").click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText("Account created. Sign in to continue.")).toBeVisible()

  await page.getByTestId("login-email").fill(invite.email)
  await page.getByTestId("login-password").fill(password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/mfa$/)

  const secret = (await page.getByTestId("mfa-secret").innerText()).replace(/\s/g, "")
  const enrol = await freshTotp(secret)
  await page.getByTestId("mfa-code").fill(enrol.code)
  await page.getByTestId("mfa-verify").click()

  await expect(page.getByTestId("recovery-codes")).toBeVisible()
  await expect(page.getByTestId("mfa-continue")).toBeDisabled()
  await page.getByTestId("recovery-saved").click()
  await expect(page.getByTestId("mfa-continue")).toBeEnabled()
  await page.getByTestId("mfa-continue").click()

  appendCredentialEntry({
    section: "Vendor portal browser specs",
    what: `Vendor portal user ${invite.email}`,
    flow: "vendor portal sign-in spec",
    reset: "rerun the demo vendor seed with --reset",
    values: `password ${password}; TOTP secret ${secret}`,
  })

  // After enrolment the portal either shows home or asks for a fresh sign-in,
  // depending on how the session reports two-factor right after enrolment.
  await page.waitForURL((url) => inPortal(url) === "/" || inPortal(url) === "/login")
  let usedStep = enrol.step
  if (inPortal(new URL(page.url())) === "/login") {
    usedStep = await signIn(page, { email: invite.email, password, secret, usedStep })
  }
  await expect(page.getByTestId("screen-home")).toBeVisible()

  // The token lives in page memory only: no cookie, no stored value.
  expect(await page.context().cookies(portalOrigin)).toEqual([])
  expect(
    await page.evaluate(() => window.localStorage.length + window.sessionStorage.length)
  ).toBe(0)

  await page.getByTestId("sign-out").click()
  await expect(page).toHaveURL(/\/login$/)
  usedStep = await signIn(page, { email: invite.email, password, secret, usedStep })

  // A reload drops the in-memory token, so the vendor lands on the sign-in screen.
  await expect(page).toHaveURL(/\/vendor-portal\/?$/)
  await page.reload()
  await expect(page.getByTestId("login-form")).toBeVisible()
})

test("a wrong password shows one fixed message", async ({ page }) => {
  await page.goto(`${portal}/login`)
  await page.getByTestId("login-email").fill("nobody@example.test")
  await page.getByTestId("login-password").fill("not-the-right-password")
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("login-error")).toHaveText("Email or password is incorrect.")
})

test("an invalid invitation link shows the generic message and no form", async ({ page }) => {
  await page.goto(`${portal}/accept-invite#token=abc`)
  await expect(page.getByTestId("accept-error")).toBeVisible()
  await expect(page.getByTestId("accept-form")).toHaveCount(0)
  expect(page.url()).not.toContain("token")

  await page.goto(`${portal}/accept-invite`)
  await expect(page.getByTestId("accept-error")).toBeVisible()
  await expect(page.getByTestId("accept-form")).toHaveCount(0)
})

test("an anonymous visitor is sent to sign in", async ({ page }) => {
  await page.goto(`${portal}/`)
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId("login-form")).toBeVisible()
})
