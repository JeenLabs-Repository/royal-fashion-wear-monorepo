import { existsSync } from "node:fs"
import path from "node:path"
import { type Page, expect, test } from "@playwright/test"
import { defaultTarget, findRepoRoot, loginAsDemo } from "../support/admin-login"

// Precondition. Start the backend with `pnpm backend:dev`, then seed the demo
// vendors with `pnpm -C apps/backend exec medusa exec ./src/scripts/seed-vendors.ts`.
// The seed writes e2e/.auth/vendor-seed.json, which this spec checks for.
const SEED_FILE = path.join("e2e", ".auth", "vendor-seed.json")
const target = defaultTarget()

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "admin screens are checked on the desktop project")
  if (!existsSync(path.join(findRepoRoot(), SEED_FILE))) {
    throw new Error(
      `${SEED_FILE} is missing. Seed the demo vendors first: pnpm -C apps/backend exec medusa exec ./src/scripts/seed-vendors.ts`
    )
  }
})

const open = async (page: Page, route: string) => {
  await page.goto(`${target.adminUrl}${route}`)
}

const openVendor = async (page: Page, name: string) => {
  await open(page, "/vendors")
  await expect(page.getByTestId("vendors-table")).toBeVisible()
  // Search so a long vendor list still finds the demo row on the first page.
  await page.getByRole("searchbox", { name: "Search by internal name" }).fill(name)
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible()
  await page.getByRole("link", { name, exact: true }).click()
  await expect(page.getByTestId("vendor-detail")).toBeVisible()
}

const confirmDialog = async (page: Page, name: string) => {
  await page.getByRole("alertdialog").getByRole("button", { name, exact: true }).click()
}

const suspendWithReason = async (page: Page, reason: string, buttonName: string) => {
  const input = page.getByTestId("reason-input")
  await input.fill(reason)
  const confirm = page.getByTestId("reason-confirm")
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(page.getByText(buttonName === "Suspend" ? "Vendor suspended" : "Vendor reactivated").first()).toBeVisible()
}

test("list shows demo vendors, filters, search and the state strip", async ({ page }) => {
  await loginAsDemo(page, "superadmin")
  await open(page, "/vendors")

  await expect(page.getByTestId("vendors-page")).toBeVisible()
  await expect(page.getByTestId("agreement-draft-callout")).toBeVisible()
  await expect(page.getByTestId("state-chip-IN-MH")).toBeVisible()
  await expect(page.locator('[data-single="true"]').first()).toBeVisible()

  const search = page.getByRole("searchbox", { name: "Search by internal name" })
  await search.fill("Demo Vendor Alpha")
  await expect(page.getByRole("link", { name: "Demo Vendor Alpha", exact: true })).toBeVisible()
  await search.fill("Demo Vendor Delta")
  await expect(page.getByRole("link", { name: "Demo Vendor Delta", exact: true })).toBeVisible()
  await search.fill("")

  await page.getByTestId("vendors-status-filter").getByRole("combobox").click()
  await page.getByRole("option", { name: "Suspended", exact: true }).click()
  await expect(page.getByRole("link", { name: "Demo Vendor Delta", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Demo Vendor Alpha", exact: true })).toHaveCount(0)

  await page.getByTestId("vendors-status-filter").getByRole("combobox").click()
  await page.getByRole("option", { name: "All", exact: true }).click()
  await page.getByTestId("vendors-search").fill("Alpha")
  await expect(page.getByRole("link", { name: "Demo Vendor Alpha", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Demo Vendor Delta", exact: true })).toHaveCount(0)
})

test("invite, resend and a refused activation", async ({ page }) => {
  const stamp = Date.now()
  const name = `Admin Spec Vendor ${stamp}`
  const email = `admin-spec-${stamp}@example.test`

  await loginAsDemo(page, "superadmin")
  await open(page, "/vendors")
  await page.getByTestId("invite-vendor-button").click()
  await expect(page.getByTestId("invite-vendor-form")).toBeVisible()

  await page.getByTestId("invite-internal-name").fill(name)
  await page.getByTestId("invite-contact-name").fill("Admin Spec Contact")
  await page.getByTestId("invite-contact-email").fill("not-an-email")
  await page.getByTestId("invite-vendor-submit").click()
  await expect(page.getByText("Enter a valid email address.")).toBeVisible()

  await page.getByTestId("invite-contact-email").fill(email)
  await page.getByTestId("invite-vendor-submit").click()
  await expect(page.getByText(/Invitation sent to|could not be sent/)).toBeVisible()

  const row = page.getByRole("row").filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(row.getByTestId("vendor-status-badge")).toHaveText("Invited")

  await row.getByRole("link", { name, exact: true }).click()
  await expect(page.getByTestId("vendor-detail")).toBeVisible()
  const userCard = page.getByTestId("vendor-user-card")
  await expect(userCard).toContainText("No")
  await expect(userCard).toContainText("Pending")

  await page.getByTestId("action-resend").click()
  await confirmDialog(page, "Resend invite")
  await expect(page.getByText(/Invitation sent to|could not be sent/).first()).toBeVisible()

  await page.getByTestId("action-activate").click()
  await confirmDialog(page, "Activate")
  await expect(page.getByTestId("vendor-action-error")).toContainText("has not accepted the invitation")
  await expect(page.getByTestId("vendor-status-badge")).toHaveText("Invited")
})

test("active vendor locations and suspend then reactivate", async ({ page }) => {
  await loginAsDemo(page, "superadmin")
  await openVendor(page, "Demo Vendor Alpha")

  const table = page.getByTestId("locations-table")
  await expect(table.locator('[data-testid^="location-row-LOC-"]').first()).toBeVisible()
  const before = await table.locator('[data-testid^="location-row-LOC-"]').count()

  try {
    await page.getByTestId("add-location-button").click()
    await expect(page.getByTestId("location-form")).toBeVisible()
    await page.getByTestId("location-label").fill("Admin spec warehouse")
    await page.getByTestId("location-address-1").fill("12 Test Street")
    await page.getByTestId("location-state").click()
    await page.getByRole("option", { name: "Tamil Nadu", exact: true }).click()
    await page.getByTestId("location-pin").fill("600001")
    await page.getByTestId("location-contact-name").fill("Spec Contact")
    await page.getByTestId("location-contact-phone").fill("9990011223")
    await page.getByTestId("location-submit").click()
    const createdToast = page.getByText(/Location LOC-\d+ created/)
    await expect(createdToast).toBeVisible()
    const code = /LOC-\d+/.exec(await createdToast.innerText())?.[0] ?? ""
    expect(code).not.toBe("")
    await expect(table.locator('[data-testid^="location-row-LOC-"]')).toHaveCount(before + 1)

    const created = page.getByTestId(`location-row-${code}`)
    await expect(created).toContainText("Tamil Nadu")
    await page.getByTestId(`edit-location-${code}`).click()
    await expect(page.getByText("Location codes are assigned automatically and cannot change.")).toBeVisible()
    await page.getByTestId("location-label").fill("Admin spec warehouse renamed")
    await page.getByTestId("location-status").click()
    await page.getByRole("option", { name: "Inactive", exact: true }).click()
    await page.getByTestId("location-submit").click()
    await expect(page.getByText(/Location LOC-\d+ updated/)).toBeVisible()
    await expect(table).toContainText("Admin spec warehouse renamed")

    await page.getByTestId("action-suspend").click()
    await page.getByTestId("reason-input").fill("123456789")
    await expect(page.getByTestId("reason-confirm")).toBeDisabled()
    await suspendWithReason(page, "Suspended by the admin browser spec", "Suspend")
    await expect(page.getByTestId("vendor-status-badge")).toHaveText("Suspended")

    await page.getByTestId("action-reactivate").click()
    await suspendWithReason(page, "Reactivated by the admin browser spec", "Reactivate")
    await expect(page.getByTestId("vendor-status-badge")).toHaveText("Active")
  } finally {
    // Leave the demo data as found: an interrupted run must not leave Alpha suspended.
    const badge = page.getByTestId("vendor-status-badge")
    if ((await badge.count()) > 0 && (await badge.innerText()) === "Suspended") {
      await page.getByTestId("action-reactivate").click()
      await page.getByTestId("reason-input").fill("Restored after the admin browser spec")
      await page.getByTestId("reason-confirm").click()
      await expect(badge).toHaveText("Active")
    }
  }
})

test("a read-only role sees disabled controls", async ({ page }) => {
  await loginAsDemo(page, "finance_readonly")
  await open(page, "/vendors")

  await expect(page.getByTestId("vendors-table")).toBeVisible()
  await expect(page.getByTestId("invite-vendor-button")).toBeDisabled()

  await page.getByRole("link", { name: "Demo Vendor Alpha", exact: true }).click()
  await expect(page.getByTestId("vendor-detail")).toBeVisible()
  const actions = page.locator('[data-testid^="action-"]')
  await expect(actions.first()).toBeVisible()
  const total = await actions.count()
  for (let index = 0; index < total; index += 1) {
    await expect(actions.nth(index)).toBeDisabled()
  }
  await expect(page.getByTestId("add-location-button")).toBeDisabled()
})

test("plugin sections stay hidden while no plugin registers one", async ({ page }) => {
  await loginAsDemo(page, "superadmin")
  await openVendor(page, "Demo Vendor Alpha")
  await expect(page.getByTestId("plugin-sections")).toHaveCount(0)
})
