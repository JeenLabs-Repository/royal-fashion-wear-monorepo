import { expect, test, type Page } from "@playwright/test"
import {
  MFA_API,
  apiLogin,
  callApi,
  computeTotp,
  defaultTarget,
  demoEmail,
  findFactorId,
  findRecoveryCodes,
  findTotpSecret,
  msUntilNextStep,
  readDemoPassword,
  recordTotpState,
  runStaffDemoSeed,
  signInWithForm,
  signOut,
} from "../support/admin-login"

const target = defaultTarget()

// Locators verified against Medusa Admin 2.22.7 Profile MFA and login challenge.
const SCREEN = {
  profileUrl: `${target.adminUrl}/settings/profile`,
  twoFactorHeading: (page: Page) =>
    page.getByRole("heading", { name: /two-factor authentication/i }),
  startEnrolment: (page: Page) => page.getByRole("button", { name: /^enable$/i }),
  setupHeading: (page: Page) =>
    page.getByRole("heading", { name: /set up authenticator app/i }),
  // Medusa UI OtpInput: first cell is labelled "One-time password 1" and accepts the full code.
  codeInput: (page: Page) =>
    page.getByLabel(/one-time password 1/i).or(page.locator('input[autocomplete="one-time-code"]')),
  verify: (page: Page) => page.getByRole("button", { name: /confirm|continue|verify/i }),
  recoveryCodes: (page: Page) =>
    page.getByRole("heading", { name: /recovery codes/i }).or(page.getByText(/recovery codes/i)),
  savedConfirm: (page: Page) => page.getByRole("button", { name: /^complete$/i }),
  saved: (page: Page) => page.getByText(/^enabled$/i),
  challengeHeading: (page: Page) =>
    page.getByRole("heading", { name: /two-factor authentication/i }),
  challengeVerify: (page: Page) => page.getByRole("button", { name: /^verify$/i }),
}

const isGet = (path: string) => (response: { url(): string; request(): { method(): string } }) =>
  new URL(response.url()).pathname === path && response.request().method() === "GET"

const fillOtp = async (page: Page, code: string) => {
  const input = SCREEN.codeInput(page).first()
  await expect(input).toBeVisible({ timeout: 30_000 })
  await input.click()
  // Type digit-by-digit so Medusa UI OtpInput distributes across cells and fires onComplete.
  await input.pressSequentially(code, { delay: 50 })
}

test.describe.configure({ mode: "serial" })

test.beforeAll(() => {
  // A fresh state makes the spec repeatable: new passwords and no factors.
  runStaffDemoSeed(["reset-passwords", "reset-mfa"])
})

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "admin specs run on the desktop project only")
})

test("an unenrolled support user is blocked until they enrol, then reaches only their role's screens", async ({
  page,
  request,
}) => {
  test.setTimeout(300_000)
  const email = demoEmail("support")
  const password = readDemoPassword(email)

  await test.step("the API refuses admin data but allows the allowlist before enrolment", async () => {
    const login = await apiLogin(request, target, email, password)
    expect(login.status).toBe(200)
    expect(login.challenge).toBe(false)
    expect(login.token).not.toBeNull()

    for (const path of ["/admin/orders", "/admin/products"]) {
      const result = await callApi(request, target, { method: "GET", path }, { token: login.token })
      expect(result.status).toBe(403)
      expect(result.body?.code).toBe("mfa_enrollment_required")
    }
    const me = await callApi(
      request,
      target,
      { method: "GET", path: "/admin/users/me" },
      { token: login.token }
    )
    expect(me.status).toBe(200)
  })

  await test.step("the dashboard shows no orders before enrolment", async () => {
    await signInWithForm(page, target, email, password)
    // Unenrolled staff land on Access Denied for business pages; wait for the
    // orders GET specifically (pathname match ignores query strings).
    const orders = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/admin/orders") &&
        response.request().method() === "GET",
      { timeout: 60_000 }
    )
    await page.goto(`${target.adminUrl}/orders`, { waitUntil: "domcontentloaded" })
    expect((await orders).status()).toBe(403)
    await expect(page.locator("tbody tr")).toHaveCount(0)
  })

  let secret = ""
  let factorId = ""
  const codes: string[] = []

  await test.step("enrolling TOTP under Profile and Security completes", async () => {
    page.on("response", async (response) => {
      try {
        const found = findRecoveryCodes(await response.json())
        if (found.length > 0 && codes.length === 0) codes.push(...found)
      } catch {
        // Not JSON, or a body that is no longer available.
      }
    })

    await page.goto(SCREEN.profileUrl)
    await expect(SCREEN.twoFactorHeading(page)).toBeVisible({ timeout: 60_000 })

    const started = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === MFA_API.factorStart.path &&
        response.request().method() === MFA_API.factorStart.method
    )
    await expect(SCREEN.startEnrolment(page)).toBeEnabled({ timeout: 60_000 })
    await SCREEN.startEnrolment(page).click()
    const body = await (await started).json()
    secret = findTotpSecret(body) ?? ""
    factorId = findFactorId(body) ?? ""
    expect(secret).not.toBe("")

    await expect(SCREEN.setupHeading(page)).toBeVisible({ timeout: 30_000 })
    await fillOtp(page, computeTotp(secret))
    // OtpInput may auto-submit on complete; Confirm still works when the code is filled.
    const confirm = SCREEN.verify(page).filter({ hasText: /confirm/i })
    if (await confirm.isEnabled().catch(() => false)) {
      await confirm.click()
    }
    await expect(SCREEN.recoveryCodes(page).first()).toBeVisible({ timeout: 30_000 })
    await SCREEN.savedConfirm(page).click()
    await expect(SCREEN.saved(page).first()).toBeVisible({ timeout: 30_000 })

    // Later browser specs reuse the recorded secret for the challenge.
    recordTotpState(email, { secret, recoveryCodes: codes })
  })

  await test.step("after signing in with a code the role's screens work and others stay denied", async () => {
    await signOut(page, target)
    await signInWithForm(page, target, email, password)

    // The enrolment code is a replay inside its own 30 second window.
    await page.waitForTimeout(msUntilNextStep() + 500)
    await expect(SCREEN.challengeHeading(page).first()).toBeVisible({ timeout: 60_000 })
    // OtpInput calls onComplete when the sixth digit is entered, so Verify may
    // already have run; only click it when the challenge screen is still open.
    await fillOtp(page, computeTotp(secret))
    const verify = SCREEN.challengeVerify(page)
    if (await verify.isVisible({ timeout: 2_000 }).catch(() => false)) {
      if (await verify.isEnabled().catch(() => false)) {
        await verify.click()
      }
    }
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 60_000,
    })

    const orders = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/admin/orders") &&
        response.request().method() === "GET",
      { timeout: 60_000 }
    )
    await page.goto(`${target.adminUrl}/orders`)
    expect((await orders).status()).toBe(200)

    const products = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/admin/products") &&
        response.request().method() === "GET",
      { timeout: 60_000 }
    )
    await page.goto(`${target.adminUrl}/products`)
    const denied = await products
    expect(denied.status()).toBe(403)
    expect((await denied.json()).code).toBe("permission_denied")
  })

  await test.step("a session alone cannot switch the factor off", async () => {
    const remove = {
      ...MFA_API.factorRemove,
      path: MFA_API.factorRemove.path.replace(":factor_id", factorId),
    }
    const attempt = await callApi(page.request, target, remove)
    expect(attempt.status).toBeGreaterThanOrEqual(400)

    const me = await callApi(page.request, target, { method: "GET", path: "/admin/staff/me" })
    expect(me.status).toBe(200)
    expect(me.body?.mfa_enabled).toBe(true)
  })
})
