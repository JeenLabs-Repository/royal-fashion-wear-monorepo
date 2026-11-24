import { execFileSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import type { APIRequestContext, Page } from "@playwright/test"
import {
  DEMO_NO_ROLE_USER,
  DEMO_STAFF,
  type DemoRoleKey,
} from "../../apps/backend/src/lib/dev-seed/demo-staff"
import { appendCredentialEntry } from "./credentials-log"

const FILE_NAME = "TEST-CREDENTIALS.local.md"
const ACCOUNTS_HEADING = "## Accounts by role"

export type Target = { backendUrl: string; adminUrl: string }

export const defaultTarget = (): Target => ({
  backendUrl: process.env.E2E_BACKEND_URL ?? "http://localhost:9000",
  adminUrl: process.env.E2E_ADMIN_URL ?? "http://localhost:9000/app",
})

export type TotpState = { secret: string; recoveryCodes: string[] }

type ApiCall = { method: "GET" | "POST" | "DELETE"; path: string }

// Paths and body fields from docs/decisions/0012-staff-governance-spike-results.md (S3).
export const MFA_API = {
  login: { method: "POST", path: "/auth/user/emailpass" } as ApiCall,
  session: { method: "POST", path: "/auth/session" } as ApiCall,
  sessionEnd: { method: "DELETE", path: "/auth/session" } as ApiCall,
  factorStart: { method: "POST", path: "/auth/mfa/factors" } as ApiCall,
  // Spike S3: POST /auth/mfa/factors requires provider: "totp".
  factorStartBody: { provider: "totp" } as Record<string, unknown>,
  factorVerify: { method: "POST", path: "/auth/mfa/factors/:factor_id/verify" } as ApiCall,
  recoveryCodes: { method: "POST", path: "/auth/mfa/recovery-codes" } as ApiCall,
  challengeVerify: { method: "POST", path: "/auth/mfa/challenges/:id/verify" } as ApiCall,
  factorRemove: { method: "DELETE", path: "/auth/mfa/factors/:factor_id" } as ApiCall,
  codeField: "code",
  methodField: "method",
  defaultMethod: "totp",
}

export const findRepoRoot = () => {
  let dir = process.cwd()
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error("Could not find pnpm-workspace.yaml above the working directory.")
    }
    dir = parent
  }
}

export const callApi = async (
  request: APIRequestContext,
  target: Target,
  call: ApiCall,
  options: { token?: string | null; body?: unknown } = {}
) => {
  const response = await request.fetch(`${target.backendUrl}${call.path}`, {
    method: call.method,
    headers: options.token ? { authorization: `Bearer ${options.token}` } : undefined,
    data: options.body,
    failOnStatusCode: false,
  })
  let body: Record<string, unknown> | null = null
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    body = null
  }
  return { status: response.status(), body }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export const base32Decode = (input: string): Buffer => {
  const clean = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase()
  const bytes: number[] = []
  let value = 0
  let bits = 0
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) {
      throw new Error("The value is not base32.")
    }
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
      value &= (1 << bits) - 1
    }
  }
  return Buffer.from(bytes)
}

// RFC 6238 with HMAC-SHA1, a 30 second step and 6 digits, so no TOTP package is needed.
export const computeTotp = (
  secret: string,
  now: number = Date.now(),
  digits = 6,
  stepSeconds = 30
): string => {
  const counter = Math.floor(now / 1000 / stepSeconds)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]
  return String(binary % 10 ** digits).padStart(digits, "0")
}

export const msUntilNextStep = (now: number = Date.now(), stepSeconds = 30) =>
  stepSeconds * 1000 - (now % (stepSeconds * 1000))

const BASE32_VALUE = /^[A-Z2-7]{16,}={0,6}$/

export const findTotpSecret = (value: unknown): string | null => {
  if (typeof value === "string") {
    if (value.startsWith("otpauth://")) {
      const secret = new URL(value).searchParams.get("secret")
      return secret ? secret.toUpperCase() : null
    }
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTotpSecret(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string" && /secret/i.test(key) && BASE32_VALUE.test(item.toUpperCase())) {
        return item.toUpperCase()
      }
      const nested = findTotpSecret(item)
      if (nested) return nested
    }
  }
  return null
}

export const findRecoveryCodes = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecoveryCodes(item)
      if (found.length > 0) return found
    }
    return []
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (/recovery/i.test(key) && Array.isArray(item)) {
        const codes = item
          .map((entry) =>
            typeof entry === "string" ? entry : (entry as { code?: unknown })?.code
          )
          .filter((entry): entry is string => typeof entry === "string")
        if (codes.length > 0) return codes
      }
      const nested = findRecoveryCodes(item)
      if (nested.length > 0) return nested
    }
  }
  return []
}

export const findFactorId = (value: unknown): string | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (typeof record.id === "string") return record.id
    if (record.mfa_factor && typeof record.mfa_factor === "object") {
      const nested = findFactorId(record.mfa_factor)
      if (nested) return nested
    }
    for (const item of Object.values(record)) {
      const found = findFactorId(item)
      if (found) return found
    }
  }
  return null
}

export type LoginResult = {
  status: number
  token: string | null
  challenge: boolean
  challengeId: string | null
  challengeMethods: string[]
  body: Record<string, unknown> | null
}

const readChallenge = (body: Record<string, unknown> | null) => {
  const challenge = body?.mfa_challenge
  if (!challenge || typeof challenge !== "object" || Array.isArray(challenge)) {
    return { challengeId: null as string | null, challengeMethods: [] as string[] }
  }
  const record = challenge as Record<string, unknown>
  const challengeId = typeof record.id === "string" ? record.id : null
  const methods = Array.isArray(record.methods)
    ? record.methods.filter((entry): entry is string => typeof entry === "string")
    : []
  return { challengeId, challengeMethods: methods }
}

export const apiLogin = async (
  request: APIRequestContext,
  target: Target,
  email: string,
  password: string
): Promise<LoginResult> => {
  const { status, body } = await callApi(request, target, MFA_API.login, {
    body: { email, password },
  })
  const token = typeof body?.token === "string" ? (body.token as string) : null
  const { challengeId, challengeMethods } = readChallenge(body)
  const challenge =
    Boolean(body?.mfa_required) ||
    Boolean(challengeId) ||
    (status === 200 &&
      body !== null &&
      Object.entries(body).some(
        ([key, value]) => /mfa|challenge|verification/i.test(key) && Boolean(value)
      ))
  return { status, token, challenge, challengeId, challengeMethods, body }
}

export const enrolTotp = async (
  request: APIRequestContext,
  target: Target,
  token: string
): Promise<TotpState> => {
  const start = await callApi(request, target, MFA_API.factorStart, {
    token,
    body: MFA_API.factorStartBody,
  })
  const secret = findTotpSecret(start.body)
  if (start.status >= 300 || !secret) {
    throw new Error(
      `Starting TOTP enrolment failed with status ${start.status}. Check MFA_API against the recorded findings.`
    )
  }
  const factorId = findFactorId(start.body) ?? ""
  const verify = await callApi(
    request,
    target,
    { ...MFA_API.factorVerify, path: MFA_API.factorVerify.path.replace(":factor_id", factorId) },
    { token, body: { [MFA_API.codeField]: computeTotp(secret) } }
  )
  if (verify.status >= 300) {
    throw new Error(`Verifying the TOTP factor failed with status ${verify.status}.`)
  }
  let recoveryCodes = findRecoveryCodes(verify.body)
  if (recoveryCodes.length === 0) {
    const generated = await callApi(request, target, MFA_API.recoveryCodes, { token })
    recoveryCodes = findRecoveryCodes(generated.body)
  }
  return { secret, recoveryCodes }
}

// Answers the login challenge. A code just used for enrolment can be refused as
// a replay, so the second attempt waits for the next 30 second window.
export const answerChallenge = async (
  request: APIRequestContext,
  target: Target,
  login: LoginResult,
  state: TotpState
): Promise<string> => {
  const challengeId = login.challengeId
  if (!challengeId) {
    throw new Error("The login response did not include an mfa_challenge id.")
  }
  const method = login.challengeMethods[0] ?? MFA_API.defaultMethod
  const path = MFA_API.challengeVerify.path.replace(":id", encodeURIComponent(challengeId))

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { status, body } = await callApi(
      request,
      target,
      { ...MFA_API.challengeVerify, path },
      {
        token: login.token,
        body: {
          [MFA_API.methodField]: method,
          [MFA_API.codeField]: computeTotp(state.secret),
        },
      }
    )
    const token = typeof body?.token === "string" ? (body.token as string) : null
    if (status < 300 && token) return token
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, msUntilNextStep() + 500))
    }
  }
  throw new Error(
    "The TOTP challenge was not accepted. If the demo user was reset, run the staff demo seed with reset-mfa and try again."
  )
}

export const establishSession = async (page: Page, target: Target, token: string) => {
  const { status } = await callApi(page.request, target, MFA_API.session, { token })
  if (status >= 300) {
    throw new Error(`Creating the admin session failed with status ${status}.`)
  }
}

export const signOut = async (page: Page, target: Target = defaultTarget()) => {
  await callApi(page.request, target, MFA_API.sessionEnd)
  await page.context().clearCookies()
}

// Signs in through the dashboard form. Specs that prove the form itself use this one.
export const signInWithForm = async (
  page: Page,
  target: Target,
  email: string,
  password: string
) => {
  await page.goto(`${target.adminUrl}/login`, { waitUntil: "domcontentloaded" })
  await page.getByRole("heading", { name: /welcome to medusa/i }).waitFor({
    state: "visible",
    timeout: 60_000,
  })
  // Medusa Admin exposes Email as the textbox accessible name; Password is a
  // placeholder only, so label-based locators miss it.
  const emailField = page.getByRole("textbox", { name: /email/i })
  const passwordField = page
    .getByPlaceholder(/password/i)
    .or(page.getByRole("textbox", { name: /password/i }))
  await emailField.fill(email)
  await passwordField.fill(password)
  const loginResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === MFA_API.login.path &&
      response.request().method() === "POST",
    { timeout: 60_000 }
  )
  await page.getByRole("button", { name: /continue|sign in|log in/i }).click()
  const result = await loginResponse
  if (result.status() >= 400) {
    throw new Error(`Dashboard sign-in failed with status ${result.status()}.`)
  }
}

const credentialsText = () => {
  const file = path.join(findRepoRoot(), FILE_NAME)
  return existsSync(file) ? readFileSync(file, "utf8") : ""
}

const accountRows = (text: string): string[][] => {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => line.trim() === ACCOUNTS_HEADING)
  if (start === -1) return []
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "))
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|").map((cell) => cell.trim()))
}

export const readDemoPassword = (email: string): string => {
  let found: string | null = null
  for (const cells of accountRows(credentialsText())) {
    if (cells.length >= 6 && cells[2] === email && cells[3] && !cells[3].includes("not recoverable")) {
      found = cells[3]
    }
  }
  if (!found) {
    throw new Error(
      `No password is recorded for ${email}. Run: pnpm --dir apps/backend run seed:staff-demo -- reset-passwords`
    )
  }
  return found
}

const totpLabel = (email: string) => `TOTP secret for ${email}`

export const readTotpState = (email: string): TotpState | null => {
  let found: TotpState | null = null
  for (const cells of accountRows(credentialsText())) {
    if (cells.length >= 6 && cells[1] === totpLabel(email)) {
      const secret = /secret ([A-Z2-7=]+)/.exec(cells[3])?.[1]
      const codes = /recovery codes (.*)$/.exec(cells[3])?.[1]?.split(" ").filter(Boolean) ?? []
      if (secret) found = { secret, recoveryCodes: codes }
    }
  }
  return found
}

// The secret is demo data. The credentials file is untracked and the owner can reuse it in an authenticator.
export const recordTotpState = (email: string, state: TotpState) => {
  appendCredentialEntry({
    section: "Accounts by role",
    what: totpLabel(email),
    flow: "admin sign-in helper",
    reset: "run the staff demo seed with reset-mfa",
    values: `secret ${state.secret}; recovery codes ${state.recoveryCodes.join(" ")}`,
  })
}

// Signs in with a password, enrolling TOTP first when the account has no factor,
// and answering the challenge when it has one. The page ends up with a session cookie.
export const loginWithState = async (
  page: Page,
  email: string,
  password: string,
  options: {
    state?: TotpState | null
    target?: Target
    onEnrolled?: (state: TotpState) => void
  } = {}
) => {
  const target = options.target ?? defaultTarget()
  const first = await apiLogin(page.request, target, email, password)
  if (first.status !== 200) {
    throw new Error(`Sign-in for ${email} failed with status ${first.status}.`)
  }

  let state = options.state ?? null
  let token: string
  if (first.challenge) {
    if (!state) {
      throw new Error(
        `${email} already has a TOTP factor but no secret is recorded. Run the staff demo seed with reset-mfa.`
      )
    }
    token = await answerChallenge(page.request, target, first, state)
  } else {
    if (!first.token) {
      throw new Error(`Sign-in for ${email} returned no token.`)
    }
    state = await enrolTotp(page.request, target, first.token)
    options.onEnrolled?.(state)
    const second = await apiLogin(page.request, target, email, password)
    token = await answerChallenge(page.request, target, second, state)
  }

  await establishSession(page, target, token)
  // Land on Profile, not the default orders/products home. Narrow roles such as
  // support lack catalog and orders permissions, and Medusa shows Access Denied
  // for those homes before a custom page can render.
  await page.goto(`${target.adminUrl}/settings/profile`)
  return { email, state, token }
}

export type DemoLogin = DemoRoleKey | "no-role"

export const demoEmail = (role: DemoLogin): string => {
  if (role === "no-role") return DEMO_NO_ROLE_USER.email
  const entry = DEMO_STAFF.find((candidate) => candidate.roleKey === role)
  if (!entry) throw new Error(`There is no demo user for ${role}.`)
  return entry.email
}

export const loginAsDemo = async (
  page: Page,
  role: DemoLogin,
  target: Target = defaultTarget()
) => {
  const email = demoEmail(role)
  return loginWithState(page, email, readDemoPassword(email), {
    state: readTotpState(email),
    target,
    onEnrolled: (state) => recordTotpState(email, state),
  })
}

// Runs the dev demo seed as a child process. The seed refuses in production and never prints a password.
export const runStaffDemoSeed = (words: string[] = []) =>
  execFileSync("pnpm", ["--dir", "apps/backend", "run", "seed:staff-demo", "--", ...words], {
    cwd: findRepoRoot(),
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32",
  })
