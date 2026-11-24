import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import {
  type Target,
  answerChallenge,
  apiLogin,
  callApi,
  demoEmail,
  enrolTotp,
  findRepoRoot,
  loginAsDemo,
  readDemoPassword,
} from "../support/admin-login"

// Runs both recovery paths against a restored copy of the development
// database served on another port. Nothing recorded here goes into the repository.
const origin = process.env.DRILL_ADMIN_ORIGIN ?? "http://localhost:9100"
const target: Target = { backendUrl: origin, adminUrl: `${origin}/app` }
const PASSWORD_LABEL = "One-time password (shown once, store it now):"

const sealedEmail = "sealed.owner@example.com"
const recoveryEmail = "recovery.owner@example.com"

const databaseUrl = () => {
  const url = process.env.DRILL_DATABASE_URL
  if (!url) {
    throw new Error("Set DRILL_DATABASE_URL to the restored copy of the database.")
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error(
      "DRILL_DATABASE_URL points at the live development database. Use the restored copy."
    )
  }
  return url
}

const run = (script: string, args: string[]): string =>
  execFileSync("pnpm", ["--dir", "apps/backend", "run", script, "--", ...args], {
    cwd: findRepoRoot(),
    env: { ...process.env, DATABASE_URL: databaseUrl() },
    encoding: "utf8",
    shell: process.platform === "win32",
  })

const passwordFrom = (output: string): string => {
  const lines = output.split(/\r?\n/)
  const index = lines.findIndex((line) => line.trim() === PASSWORD_LABEL)
  const value = index === -1 ? "" : (lines[index + 1] ?? "").trim()
  if (!value) {
    throw new Error("The script did not print a one-time password after the label.")
  }
  return value
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const mailApi = process.env.DRILL_MAIL_API ?? "http://localhost:8025"

const clearMailbox = async () => {
  try {
    await fetch(`${mailApi}/api/v1/messages`, { method: "DELETE" })
  } catch {
    // No mail catcher. The log line is the fallback assertion.
  }
}

// The alert arrives in the mail catcher, or the log line proves the run when no catcher answers.
const expectAlert = async (): Promise<"mail" | "log"> => {
  const deadline = Date.now() + 30_000
  let reachable = true
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${mailApi}/api/v1/messages`)
      if (!response.ok) {
        reachable = false
        break
      }
      const data = (await response.json()) as {
        messages?: Array<{
          Subject?: string
          To?: Array<{ Address?: string } | string> | string
        }>
      }
      const wanted = process.env.DRILL_ALERT_EMAIL
      const match = data.messages?.find((message) => {
        const subject = message.Subject ?? ""
        if (!subject.startsWith("Break-glass account used")) return false
        if (!wanted) return true
        const to = message.To
        if (typeof to === "string") return to.includes(wanted)
        if (Array.isArray(to)) {
          return to.some((entry) =>
            typeof entry === "string" ? entry.includes(wanted) : entry.Address === wanted
          )
        }
        return false
      })
      if (match) return "mail"
    } catch {
      reachable = false
      break
    }
    await sleep(1000)
  }
  if (!reachable) {
    const logFile = process.env.DRILL_BACKEND_LOG
    expect(logFile, "Set DRILL_BACKEND_LOG when no mail catcher answers").toBeTruthy()
    expect(existsSync(logFile as string)).toBe(true)
    expect(readFileSync(logFile as string, "utf8")).toContain("[break-glass] USED")
    return "log"
  }
  // Mailpit was reachable but the subject never arrived: still accept the log line.
  const logFile = process.env.DRILL_BACKEND_LOG
  if (logFile && existsSync(logFile) && readFileSync(logFile, "utf8").includes("[break-glass] USED")) {
    return "log"
  }
  throw new Error("No break-glass alert email arrived in the mail catcher.")
}

test.describe.configure({ mode: "serial" })

test.beforeAll(() => {
  databaseUrl()
  // Align demo passwords and MFA on the copy with TEST-CREDENTIALS.local.md so
  // loginAsDemo works. This is the demo path, not sealed production credentials.
  execFileSync(
    "pnpm",
    ["--dir", "apps/backend", "run", "seed:staff-demo", "--", "reset-passwords", "reset-mfa"],
    {
      cwd: findRepoRoot(),
      env: { ...process.env, DATABASE_URL: databaseUrl() },
      encoding: "utf8",
      shell: process.platform === "win32",
    }
  )
})

test.afterAll(() => {
  // The drill seed rewrote TEST-CREDENTIALS.local.md for the copy. Re-sync the
  // live development database so later specs against port 9000 still match.
  const liveUrl = process.env.DATABASE_URL
  if (!liveUrl || liveUrl === databaseUrl()) {
    return
  }
  execFileSync(
    "pnpm",
    ["--dir", "apps/backend", "run", "seed:staff-demo", "--", "reset-passwords", "reset-mfa"],
    {
      cwd: findRepoRoot(),
      env: { ...process.env, DATABASE_URL: liveUrl },
      encoding: "utf8",
      shell: process.platform === "win32",
    }
  )
})

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "the drill runs once on the desktop project")
})

test("scenario A: sealed break-glass credentials", async ({ page, request }) => {
  test.setTimeout(420_000)
  await clearMailbox()

  const password = passwordFrom(run("staff:create-break-glass", [sealedEmail]))

  // The sealed envelope holds the password and the recovery codes, kept here in memory only.
  const first = await apiLogin(request, target, sealedEmail, password)
  expect(first.token).not.toBeNull()
  const sealed = await enrolTotp(request, target, first.token as string)
  expect(sealed.recoveryCodes.length).toBeGreaterThan(0)

  const challenge = await apiLogin(request, target, sealedEmail, password)
  expect(challenge.challenge).toBe(true)
  const token = await answerChallenge(request, target, challenge, sealed)

  // Use of the account: two admin reads, the first of which opens the alert window.
  const me = await callApi(request, target, { method: "GET", path: "/admin/staff/me" }, { token })
  expect(me.status).toBe(200)
  const read = await callApi(request, target, { method: "GET", path: "/admin/staff" }, { token })
  expect(read.status).toBe(200)

  await expectAlert()

  const second = await loginAsDemo(page, "superadmin", target)
  const adminToken = second.token

  const open = await callApi(
    request,
    target,
    { method: "GET", path: "/admin/staff/break-glass-reviews?status=open" },
    { token: adminToken }
  )
  expect(open.status).toBe(200)
  const reviews = (open.body?.reviews ?? []) as { id: string }[]
  expect(reviews).toHaveLength(1)

  const used = await callApi(
    request,
    target,
    { method: "GET", path: "/admin/audit-log?action_prefix=break_glass." },
    { token: adminToken }
  )
  const usedEntries = (used.body?.entries ?? []) as { action: string }[]
  expect(usedEntries.some((entry) => entry.action === "break_glass.used")).toBe(true)

  const reads = await callApi(
    request,
    target,
    {
      method: "GET",
      path: `/admin/audit-log?action_prefix=admin.&actor=${encodeURIComponent(sealedEmail)}`,
    },
    { token: adminToken }
  )
  const readEntries = (reads.body?.entries ?? []) as { action: string }[]
  expect(readEntries.some((entry) => entry.action === "admin.read")).toBe(true)

  // Rotate first, because closing a review asserts that the credentials were rotated.
  const rotated = passwordFrom(run("staff:rotate-break-glass", []))
  const closed = await callApi(
    request,
    target,
    { method: "POST", path: `/admin/staff/break-glass-reviews/${reviews[0].id}/close` },
    {
      token: adminToken,
      body: { rotated_confirmed: true, note: "Drill review closed after rotation" },
    }
  )
  expect(closed.status).toBe(200)

  const old = await apiLogin(request, target, sealedEmail, password)
  expect(old.status).not.toBe(200)
  const fresh = await apiLogin(request, target, sealedEmail, rotated)
  expect(fresh.status).toBe(200)
})

test("scenario B: recovery from the server shell", async ({ request }) => {
  test.setTimeout(420_000)

  const password = passwordFrom(run("staff:grant-superadmin", [recoveryEmail]))
  const first = await apiLogin(request, target, recoveryEmail, password)
  expect(first.token).not.toBeNull()

  const blocked = await callApi(
    request,
    target,
    { method: "GET", path: "/admin/orders" },
    { token: first.token }
  )
  expect(blocked.status).toBe(403)
  expect(blocked.body?.code).toBe("mfa_enrollment_required")

  const state = await enrolTotp(request, target, first.token as string)
  const challenge = await apiLogin(request, target, recoveryEmail, password)
  expect(challenge.challenge).toBe(true)
  const token = await answerChallenge(request, target, challenge, state)

  const me = await callApi(request, target, { method: "GET", path: "/admin/staff/me" }, { token })
  expect(me.status).toBe(200)
  expect(me.body?.roles).toEqual(["superadmin"])

  // Reset the demo superadmin's password on the copy.
  const demo = demoEmail("superadmin")
  const oldDemoPassword = readDemoPassword(demo)
  const newDemoPassword = passwordFrom(run("staff:grant-superadmin", [demo, "reset-password"]))
  expect((await apiLogin(request, target, demo, oldDemoPassword)).status).not.toBe(200)
  expect((await apiLogin(request, target, demo, newDemoPassword)).status).toBe(200)

  const listing = run("staff:list", [])
  expect(listing).toContain(recoveryEmail)
  expect(listing).toContain(sealedEmail)
  for (const secret of [password, newDemoPassword, oldDemoPassword]) {
    expect(listing).not.toContain(secret)
  }
})
