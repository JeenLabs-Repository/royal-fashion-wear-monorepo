import { expect, test } from "@playwright/test"
import {
  DEMO_NO_ROLE_USER,
  DEMO_STAFF,
} from "../../apps/backend/src/lib/dev-seed/demo-staff"
import { ROLE_DEFINITIONS } from "../../apps/backend/src/lib/rbac/permissions"
import { defaultTarget, loginAsDemo } from "../support/admin-login"
import { assignRole, chooseAndAssign, revokeRole, rowFor } from "../support/staff-ui"

const { adminUrl } = defaultTarget()

const labelOf = (key: string) => {
  const role = ROLE_DEFINITIONS.find((candidate) => candidate.key === key)
  if (!role) throw new Error(`Unknown role ${key}`)
  return role.label as string
}

test.describe.configure({ mode: "serial" })

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "admin specs run on the desktop project only")
})

test("superadmin sees every demo user with the right role badge", async ({ page }) => {
  await loginAsDemo(page, "superadmin")
  await page.goto(`${adminUrl}/staff`)
  await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible()

  for (const entry of DEMO_STAFF) {
    const row = rowFor(page, entry.email)
    await expect(row).toBeVisible()
    await expect(row).toContainText(labelOf(entry.roleKey))
  }
  await expect(rowFor(page, DEMO_NO_ROLE_USER.email)).toContainText("No roles")
})

test("superadmin assigns and revokes a role through the dialogs", async ({ page }) => {
  await loginAsDemo(page, "superadmin")
  await page.goto(`${adminUrl}/staff`)
  const label = labelOf("support")
  const row = rowFor(page, DEMO_NO_ROLE_USER.email)

  // A failed earlier run can leave the role behind, so start from a known state.
  if ((await row.textContent())?.includes(label)) {
    await revokeRole(page, DEMO_NO_ROLE_USER.email, label)
    await page.keyboard.press("Escape")
  }

  await assignRole(page, DEMO_NO_ROLE_USER.email, label)
  await page.keyboard.press("Escape")
  await expect(row).toContainText(label)

  await revokeRole(page, DEMO_NO_ROLE_USER.email, label)
  await page.keyboard.press("Escape")
  await expect(row).toContainText("No roles")
})

test("the server's exclusivity message shows when a superadmin is given another role", async ({
  page,
}) => {
  await loginAsDemo(page, "superadmin")
  await page.goto(`${adminUrl}/staff`)
  const superadmin = DEMO_STAFF.find((entry) => entry.roleKey === "superadmin")
  if (!superadmin) throw new Error("The demo superadmin is missing from the constants.")

  const drawer = await chooseAndAssign(page, superadmin.email, labelOf("catalog_approver"))
  const alert = drawer.getByRole("alert")
  await expect(alert).toBeVisible()
  await expect(alert).toContainText(/superadmin/i)
})

for (const role of ["support", "no-role"] as const) {
  test(`the ${role} demo user sees the no-access state and no staff data`, async ({ page }) => {
    const login = await loginAsDemo(page, role)
    await page.goto(`${adminUrl}/staff`)
    await expect(page.getByText("You do not have access to staff management.")).toBeVisible()

    const others = [
      ...DEMO_STAFF.map((entry) => entry.email),
      DEMO_NO_ROLE_USER.email,
    ].filter((email) => email !== login.email)
    for (const email of others) {
      await expect(page.locator("body")).not.toContainText(email)
    }
  })
}
