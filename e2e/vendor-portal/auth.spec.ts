import { expect, test } from "@playwright/test"
import {
  enrolTotp,
  finishEnrolment,
  portalOrigin,
  portalUrl,
  signIn,
  signInFreshVendor,
} from "../helpers/vendor-flow"
import { seedFreshVendor } from "../helpers/vendor-seed"
import { appendCredentialEntry } from "../support/credentials-log"

// Precondition. The backend must be running with `pnpm backend:dev`, the demo
// vendor seed must have run, and the portal origin (http://localhost:5173) must
// be listed in the backend auth CORS setting. Set E2E_PORTAL_URL to
// http://localhost:9000/vendor-portal to run against the backend-served build.

test("an invited vendor accepts the link, signs in and enrols two-factor sign-in", async ({
  page,
}) => {
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

  const enrolled = await enrolTotp(page)
  appendCredentialEntry({
    section: "Vendor portal browser specs",
    what: `Vendor portal user ${invite.email}`,
    flow: "vendor portal sign-in spec",
    reset: "rerun the vendor seed with --reset",
    values: `password ${password}; TOTP secret ${enrolled.secret}`,
  })

  const usedStep = await finishEnrolment(page, { email: invite.email, password }, enrolled)

  // The token lives in page memory only: no cookie, no stored value.
  expect(await page.context().cookies(portalOrigin)).toEqual([])
  expect(
    await page.evaluate(() => window.localStorage.length + window.sessionStorage.length)
  ).toBe(0)

  await page.getByTestId("sign-out").click()
  await expect(page).toHaveURL(/\/login$/)
  await signIn(page, { email: invite.email, password, secret: enrolled.secret, usedStep })

  // A reload drops the in-memory token, so the vendor lands on the sign-in screen.
  await page.reload()
  await expect(page.getByTestId("login-form")).toBeVisible()
})

test("a registered vendor enrols and signs in again with a fresh code", async ({ page }) => {
  test.setTimeout(120_000)
  const vendor = await signInFreshVendor(page)
  await page.getByTestId("sign-out").click()
  await expect(page).toHaveURL(/\/login$/)
  await signIn(page, vendor)
})

test("a wrong password shows one fixed message", async ({ page }) => {
  await page.goto(`${portalUrl}/login`)
  await page.getByTestId("login-email").fill("nobody@example.test")
  await page.getByTestId("login-password").fill("not-the-right-password")
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("login-error")).toHaveText("Email or password is incorrect.")
})

test("an invalid invitation link shows the generic message and no form", async ({ page }) => {
  await page.goto(`${portalUrl}/accept-invite#token=abc`)
  await expect(page.getByTestId("accept-error")).toBeVisible()
  await expect(page.getByTestId("accept-form")).toHaveCount(0)
  expect(page.url()).not.toContain("token")

  await page.goto(`${portalUrl}/accept-invite`)
  await expect(page.getByTestId("accept-error")).toBeVisible()
  await expect(page.getByTestId("accept-form")).toHaveCount(0)
})

test("an anonymous visitor is sent to sign in", async ({ page }) => {
  await page.goto(`${portalUrl}/`)
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId("login-form")).toBeVisible()
})
