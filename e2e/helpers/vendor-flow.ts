import { type Page, expect } from "@playwright/test"
import { appendCredentialEntry } from "../support/credentials-log"
import { freshTotp } from "./totp"
import { seedFreshRegisteredVendor } from "./vendor-seed"

// The portal lives under the /vendor-portal base path. Set E2E_PORTAL_URL to
// http://localhost:9000/vendor-portal to run against the backend-served build.
export const portalUrl = process.env.E2E_PORTAL_URL ?? "http://localhost:5173/vendor-portal"
export const portalOrigin = new URL(portalUrl).origin

// Path inside the portal, without the base path.
export const inPortal = (url: URL): string => url.pathname.replace(/^\/vendor-portal/, "") || "/"

// Changes the route without a page load. The portal keeps the vendor's token in
// page memory only, so a fresh page load (page.goto, page.reload) signs the vendor
// out. This pushes a history entry and tells the router about it.
export const navigateInApp = async (page: Page, route: string): Promise<void> => {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }, `/vendor-portal${route}`)
}

export type VendorCredentials = {
  email: string
  password: string
  secret: string
  usedStep?: number
}

// Signs in from the sign-in screen and answers the two-factor challenge.
// Returns the time step of the code it used, so the next sign-in can wait it out.
export const signIn = async (page: Page, credentials: VendorCredentials): Promise<number> => {
  await page.goto(`${portalUrl}/login`)
  await page.getByTestId("login-email").fill(credentials.email)
  await page.getByTestId("login-password").fill(credentials.password)
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("login-code")).toBeVisible()
  const { code, step } = await freshTotp(credentials.secret, credentials.usedStep)
  await page.getByTestId("login-code").fill(code)
  await page.getByTestId("login-code-submit").click()
  await expect(page.getByTestId("screen-home")).toBeVisible()
  return step
}

// Runs the enrolment screen to the end: reads the setup key, verifies a code,
// confirms the recovery codes and continues. Returns the secret and the step used.
export const enrolTotp = async (page: Page): Promise<{ secret: string; step: number }> => {
  await expect(page.getByTestId("mfa-secret")).toBeVisible()
  const secret = (await page.getByTestId("mfa-secret").innerText()).replace(/\s/g, "")
  const { code, step } = await freshTotp(secret)
  await page.getByTestId("mfa-code").fill(code)
  await page.getByTestId("mfa-verify").click()
  await expect(page.getByTestId("recovery-codes")).toBeVisible()
  await expect(page.getByTestId("mfa-continue")).toBeDisabled()
  await page.getByTestId("recovery-saved").click()
  await expect(page.getByTestId("mfa-continue")).toBeEnabled()
  await page.getByTestId("mfa-continue").click()
  return { secret, step }
}

// After enrolment the portal shows home or asks for a fresh sign-in, depending
// on how the current token reports two-factor right after enrolment.
export const finishEnrolment = async (
  page: Page,
  credentials: { email: string; password: string },
  enrolled: { secret: string; step: number }
): Promise<number> => {
  await page.waitForURL((url) => inPortal(url) === "/" || inPortal(url) === "/login")
  if (inPortal(new URL(page.url())) === "/login") {
    return signIn(page, { ...credentials, secret: enrolled.secret, usedStep: enrolled.step })
  }
  await expect(page.getByTestId("screen-home")).toBeVisible()
  return enrolled.step
}

// Creates a registered vendor with the demo seed, signs in, enrols two-factor
// sign-in and lands on home. Returns what a later sign-in needs.
export const signInFreshVendor = async (
  page: Page,
  options: { status?: "invited" | "active" } = {}
): Promise<VendorCredentials> => {
  const vendor = seedFreshRegisteredVendor(options.status)

  await page.goto(`${portalUrl}/login`)
  await page.getByTestId("login-email").fill(vendor.email)
  await page.getByTestId("login-password").fill(vendor.password)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/mfa$/)

  const enrolled = await enrolTotp(page)
  const usedStep = await finishEnrolment(page, vendor, enrolled)

  appendCredentialEntry({
    section: "Vendor portal browser specs",
    what: `Fresh vendor portal user ${vendor.email}`,
    flow: "vendor portal browser specs (fresh vendor seed option)",
    reset: "rerun the vendor seed with --reset",
    values: `password ${vendor.password}; TOTP secret ${enrolled.secret}`,
  })

  return { email: vendor.email, password: vendor.password, secret: enrolled.secret, usedStep }
}
