import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { ROLE_DEFINITIONS } from "../../apps/backend/src/lib/rbac/permissions"
import { defaultTarget, loginAsDemo, type DemoLogin } from "../support/admin-login"

const target = defaultTarget()

// Superadmin is left out. Every other role is probed on every page it may open.
const ROLES: DemoLogin[] = ["order_router", "support", "finance_readonly", "catalog_approver"]

const PAGES_BY_PERMISSION: [permission: string, path: string][] = [
  ["orders:read", "/orders"],
  ["catalog:read", "/products"],
  ["customers:read", "/customers"],
  ["returns:read", "/orders"], // returns sit under orders in the MIT dashboard
]

type Hit = { role: string; template: string; code: string }

const templateOf = (pathname: string) => pathname.replace(/\/[a-z]+_[0-9A-Za-z]{8,}/g, "/:id")

test.describe.configure({ mode: "serial" })

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "admin specs run on the desktop project only")
})

test("measure the admin reads each role's dashboard makes while loading", async ({ browser }) => {
  test.setTimeout(600_000)
  const hits: Hit[] = []
  const serverErrors: string[] = []
  let pagesVisited = 0

  for (const role of ROLES) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const pending: Promise<void>[] = []

    page.on("response", (response) => {
      const url = new URL(response.url())
      if (!url.pathname.startsWith("/admin/")) return
      const status = response.status()
      if (status >= 500) {
        serverErrors.push(`${role} ${response.request().method()} ${url.pathname} ${status}`)
      }
      if (response.request().method() !== "GET" || status !== 403) return
      pending.push(
        response
          .json()
          .then((body) => {
            const code = String((body as { code?: unknown }).code ?? "unknown")
            if (code === "permission_denied" || code === "no_staff_role") {
              hits.push({ role, template: templateOf(url.pathname), code })
            }
          })
          .catch(() => undefined)
      )
    })

    await loginAsDemo(page, role, target)

    const definition = ROLE_DEFINITIONS.find((candidate) => candidate.key === role)
    const permissions = (definition?.permissions ?? []) as readonly string[]
    const paths = [
      "/",
      "/staff",
      ...PAGES_BY_PERMISSION.filter(([permission]) => permissions.includes(permission)).map(
        ([, path]) => path
      ),
    ]
    // Unique paths only.
    const uniquePaths = [...new Set(paths)]

    for (const path of uniquePaths) {
      await page.goto(`${target.adminUrl}${path}`, { waitUntil: "networkidle" })
      await Promise.all(pending.splice(0))
      const text = (await page.locator("body").innerText()).trim()
      expect(text.length, `${role} ${path} rendered a blank screen`).toBeGreaterThan(0)
      pagesVisited += 1
    }
    await context.close()
  }

  const byTemplate = new Map<string, Set<string>>()
  for (const hit of hits) {
    byTemplate.set(hit.template, (byTemplate.get(hit.template) ?? new Set()).add(hit.role))
  }
  const table = [...byTemplate.entries()]
    .map(([template, roles]) => ({
      path: template,
      roles: [...roles].sort().join(","),
      every_role: roles.size === ROLES.length,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  console.table(table)
  mkdirSync("test-results", { recursive: true })
  writeFileSync(
    "test-results/shell-probe.json",
    JSON.stringify({ roles: ROLES, table, hits, probed_on: new Date().toISOString() }, null, 2)
  )

  expect(pagesVisited).toBeGreaterThan(0)
  expect(serverErrors).toEqual([])
})
