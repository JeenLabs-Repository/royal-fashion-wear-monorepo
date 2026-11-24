import { expect, test } from "@playwright/test"
import { DEMO_NO_ROLE_USER } from "../../apps/backend/src/lib/dev-seed/demo-staff"
import { ROLE_DEFINITIONS } from "../../apps/backend/src/lib/rbac/permissions"
import { defaultTarget, loginAsDemo } from "../support/admin-login"
import { assignRole, revokeRole } from "../support/staff-ui"

const { adminUrl } = defaultTarget()

const supportLabel = ROLE_DEFINITIONS.find((role) => role.key === "support")?.label as string

// Serial within this file. Pair with --workers=1 when running alongside
// staff-page.spec.ts so both do not mutate the same demo no-role user at once.
test.describe.configure({ mode: "serial" })

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "admin specs run on the desktop project only")
})

test("superadmin sees the role assignment in the audit log with its before and after", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await loginAsDemo(page, "superadmin")
  await page.goto(`${adminUrl}/staff`)

  // Start from a known empty role set on the shared demo no-role account.
  const row = page.getByRole("row", { name: new RegExp(DEMO_NO_ROLE_USER.email.replace(/\./g, "\\.")) })
  if ((await row.textContent())?.includes(supportLabel)) {
    await revokeRole(page, DEMO_NO_ROLE_USER.email, supportLabel)
    await page.keyboard.press("Escape")
  }

  await assignRole(page, DEMO_NO_ROLE_USER.email, supportLabel)
  await page.keyboard.press("Escape")

  try {
    await page.goto(`${adminUrl}/audit-log`)
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible()

    const auditRow = page.getByRole("row", { name: /staff\.role_assigned/ }).first()
    await expect(auditRow).toBeVisible()
    await auditRow.getByRole("button", { name: "Details" }).click()
    await expect(page.getByRole("dialog")).toContainText("roles")
    await page.keyboard.press("Escape")

    await page.getByLabel("Action prefix").fill("staff.")
    await page.getByRole("button", { name: "Apply" }).click()
    await expect(page.getByRole("row", { name: /staff\./ }).first()).toBeVisible()
    const actions = await page.locator("tbody tr td:nth-child(3)").allTextContents()
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) {
      expect(action.startsWith("staff.")).toBe(true)
    }

    // There is no export and no edit control anywhere on the page.
    await expect(page.getByRole("main").getByText(/export/i)).toHaveCount(0)
    await expect(
      page.getByRole("main").getByRole("button", { name: /export|delete|edit/i })
    ).toHaveCount(0)
  } finally {
    await page.goto(`${adminUrl}/staff`)
    await revokeRole(page, DEMO_NO_ROLE_USER.email, supportLabel)
  }
})

test("the support demo user sees the no-access state", async ({ page }) => {
  await loginAsDemo(page, "support")
  await page.goto(`${adminUrl}/audit-log`)
  await expect(page.getByText("You do not have access to the audit log.")).toBeVisible()
})
