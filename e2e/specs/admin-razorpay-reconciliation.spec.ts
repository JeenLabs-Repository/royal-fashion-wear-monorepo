import { execFileSync } from "node:child_process"
import { expect, test } from "@playwright/test"
import { loginAsDemo } from "../support/admin-login"
import { appendCredentialEntry } from "../support/credentials-log"

const ORPHAN_ID = "pay_DEMO000000001"
const RESOLVED_ID = "pay_DEMO000000002"

test.describe("admin payment reconciliation", () => {
  test.beforeAll(() => {
    execFileSync(
      "pnpm",
      ["-C", "apps/backend", "exec", "medusa", "exec", "./src/scripts/seed-reconciliation-demo.ts"],
      { cwd: process.cwd(), encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" }
    )
  })

  test("shows a run, its items and a refund confirmation that can be cancelled", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "The Admin is built for desktop screens")

    await loginAsDemo(page, "superadmin")

    // The route is part of the Admin app on the same origin as the dashboard.
    const sidebarLink = page.getByRole("link", { name: "Payment reconciliation" })
    if (await sidebarLink.first().isVisible().catch(() => false)) {
      await sidebarLink.first().click()
    } else {
      await page.goto(new URL("/app/razorpay-reconciliation", page.url()).toString())
    }
    await expect(page.getByRole("heading", { name: "Payment reconciliation" })).toBeVisible()

    const run = page.getByTestId("run-row").first()
    await expect(run).toBeVisible()
    await expect(run).toContainText("completed")
    await run.click()

    const orphan = page.getByTestId("item-row").filter({ hasText: ORPHAN_ID })
    await expect(orphan).toBeVisible()
    await expect(orphan).toContainText("₹499.00")
    await expect(orphan.getByTestId("item-state")).toContainText("Open")
    const refundButton = orphan.getByTestId("refund-button")
    await expect(refundButton).toBeEnabled()

    await refundButton.click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(ORPHAN_ID)
    await expect(dialog).toContainText("₹499.00")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()

    // Cancelling changes nothing.
    await expect(orphan.getByTestId("item-state")).toContainText("Open")
    await expect(orphan.getByTestId("refund-button")).toBeEnabled()

    const resolved = page.getByTestId("item-row").filter({ hasText: RESOLVED_ID })
    await expect(resolved).toBeVisible()
    await expect(resolved.getByTestId("item-state")).toContainText("Resolved")
    await expect(resolved.getByTestId("refund-button")).toHaveCount(0)

    await appendCredentialEntry({
      section: "Form values",
      what: "payment reconciliation demo rows",
      flow: "admin-razorpay-reconciliation",
      reset: "run the demo script again; nothing to reset",
      values: `superadmin demo account; orphan payment ${ORPHAN_ID}; resolved payment ${RESOLVED_ID}`,
    })
  })
})
