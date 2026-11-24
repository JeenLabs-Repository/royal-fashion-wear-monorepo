import { expect, type Locator, type Page } from "@playwright/test"

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const rowFor = (page: Page, email: string): Locator =>
  page.getByRole("row", { name: new RegExp(escapeRegExp(email)) })

export const openManageRoles = async (page: Page, email: string): Promise<Locator> => {
  await rowFor(page, email).getByRole("button", { name: "Manage roles" }).click()
  const drawer = page.getByRole("dialog")
  await expect(drawer).toBeVisible()
  return drawer
}

// Chooses a role by its label and presses Assign. The caller decides what to wait for.
export const chooseAndAssign = async (
  page: Page,
  email: string,
  roleLabel: string
): Promise<Locator> => {
  const drawer = await openManageRoles(page, email)
  await drawer.getByRole("combobox").click()
  await page.getByRole("option", { name: roleLabel, exact: true }).click()
  await drawer.getByRole("button", { name: "Assign role" }).click()
  return drawer
}

export const assignRole = async (page: Page, email: string, roleLabel: string) => {
  const drawer = await chooseAndAssign(page, email, roleLabel)
  await expect(page.getByText("Role assigned")).toBeVisible()
  return drawer
}

export const revokeRole = async (page: Page, email: string, roleLabel: string) => {
  const drawer = await openManageRoles(page, email)
  const revokeButton = drawer.getByRole("button", { name: `Revoke ${roleLabel}` })
  // Idempotent: a parallel spec or an earlier run may already have cleared the role.
  if ((await revokeButton.count()) === 0) {
    await page.keyboard.press("Escape")
    return drawer
  }
  await revokeButton.click()
  await page.getByRole("button", { name: "Revoke role", exact: true }).click()
  await expect(page.getByText("Role revoked")).toBeVisible()
  return drawer
}
