import { ApiError } from "./errors"
import { clearToken, getToken } from "./sdk"

// The portal talks only to the vendor API, the vendor sign-in routes and the
// two-factor routes. Anything else is refused here before a request leaves the
// browser.
const ALLOWED_PATHS = [/^\/vendor\//, /^\/auth\/vendor\//, /^\/auth\/mfa\//]

type FetchOptions = {
  method?: "GET" | "POST" | "DELETE"
  body?: unknown
  token?: string
}

// Plain fetch on purpose. The SDK error type may not expose the response body,
// and the portal needs the error code (for example vendor_suspended) to route
// the vendor to the right screen.
export const fetchJson = async <T>(path: string, options: FetchOptions = {}): Promise<T> => {
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
    throw new ApiError(0, "blocked_path", "This request is not allowed.")
  }

  const headers: Record<string, string> = { accept: "application/json" }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
  }
  // An explicit token (the two-factor challenge step) wins over the stored one.
  const bearer = options.token ?? getToken()
  if (bearer) {
    headers.authorization = `Bearer ${bearer}`
  }

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "omit",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, "network_error", "The server could not be reached. Check your connection.")
  }

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    // A refused token ends the sign-in: drop it so the guards send the vendor to the login screen.
    if (response.status === 401) clearToken()
    const body = (parsed ?? {}) as { code?: unknown; type?: unknown; message?: unknown }
    const code =
      typeof body.code === "string" ? body.code : typeof body.type === "string" ? body.type : null
    const message =
      typeof body.message === "string" && body.message
        ? body.message
        : "Something went wrong. Try again."
    throw new ApiError(response.status, code, message)
  }

  return parsed as T
}

export type VendorStatus = "invited" | "active" | "suspended"

export type VendorSelf = {
  id: string
  internal_name: string
  contact_name: string
  contact_email: string
  status: VendorStatus
  activated_at: string | null
  eligible_to_list: boolean
}

export type Me = {
  vendor: VendorSelf
  user: { id: string; email: string; name: string | null }
  mfa_enabled: boolean
}

export type OnboardingStep = {
  key: string
  title: string
  required_for_activation: boolean
  complete: boolean
  link: string | null
}

export type Onboarding = {
  status: VendorStatus
  activation_pending: boolean
  steps: OnboardingStep[]
}

const PATHS = {
  me: "/vendor/me",
  onboarding: "/vendor/onboarding",
  acceptInvite: "/vendor/accept-invite",
  login: "/auth/vendor/emailpass",
} as const

export const getMe = () => fetchJson<Me>(PATHS.me)

export const getOnboarding = () => fetchJson<Onboarding>(PATHS.onboarding)

export const acceptInvite = (input: { token: string; password: string }) =>
  fetchJson<{ ok: true }>(PATHS.acceptInvite, { method: "POST", body: input })

// Paths and keys match docs/decisions/0014-vendor-actor-and-mfa-mechanics.md E7
// and apps/backend/integration-tests/helpers/mfa.ts MFA_FLOW.
export const MFA = {
  factorStart: "/auth/mfa/factors",
  factorStartBody: { provider: "totp" },
  factorVerify: (factorId: string) =>
    `/auth/mfa/factors/${encodeURIComponent(factorId)}/verify`,
  recoveryCodes: "/auth/mfa/recovery-codes",
  recoveryBody: { count: 10 },
  challengeAnswer: (challengeId: string) =>
    `/auth/mfa/challenges/${encodeURIComponent(challengeId)}/verify`,
  codeField: "code",
  methodField: "method",
  challengeKey: "mfa_challenge",
  tokenKey: "token",
} as const

const BASE32_VALUE = /^[A-Z2-7]{16,}={0,6}$/

const findSecret = (value: unknown): string | null => {
  if (typeof value === "string") {
    if (value.startsWith("otpauth://")) {
      const secret = new URL(value).searchParams.get("secret")
      return secret ? secret.toUpperCase() : null
    }
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSecret(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string" && /secret/i.test(key) && BASE32_VALUE.test(item.toUpperCase())) {
        return item.toUpperCase()
      }
      const nested = findSecret(item)
      if (nested) return nested
    }
  }
  return null
}

const findOtpauthUri = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value.startsWith("otpauth://") ? value : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOtpauthUri(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = findOtpauthUri(item)
      if (found) return found
    }
  }
  return null
}

const findFactorId = (value: unknown): string | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (typeof record.id === "string") return record.id
    for (const item of Object.values(record)) {
      const found = findFactorId(item)
      if (found) return found
    }
  }
  return null
}

const findRecoveryCodes = (value: unknown): string[] => {
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
          .map((entry) => (typeof entry === "string" ? entry : (entry as { code?: unknown })?.code))
          .filter((entry): entry is string => typeof entry === "string")
        if (codes.length > 0) return codes
      }
      const nested = findRecoveryCodes(item)
      if (nested.length > 0) return nested
    }
  }
  return []
}

export type LoginResult = {
  token: string
  challenge: boolean
  challengeId: string | null
  challengeMethod: string | null
}

export const passwordLogin = async (email: string, password: string): Promise<LoginResult> => {
  const body = await fetchJson<Record<string, unknown>>(PATHS.login, {
    method: "POST",
    body: { email, password },
  })
  const token = typeof body[MFA.tokenKey] === "string" ? (body[MFA.tokenKey] as string) : ""
  if (!token) {
    throw new ApiError(0, "no_token", "Sign-in did not return a session. Try again.")
  }
  const challenge = body[MFA.challengeKey] as { id?: string; methods?: string[] } | undefined
  const challengeId = typeof challenge?.id === "string" ? challenge.id : null
  const challengeMethod =
    Array.isArray(challenge?.methods) && typeof challenge.methods[0] === "string"
      ? challenge.methods[0]
      : challengeId
        ? "totp"
        : null
  return {
    token,
    challenge: Boolean(challengeId),
    challengeId,
    challengeMethod,
  }
}

export const answerChallenge = async (
  token: string,
  challengeId: string,
  input: { method: string; code: string }
) => {
  const body = await fetchJson<{ token?: string }>(MFA.challengeAnswer(challengeId), {
    method: "POST",
    token,
    body: {
      [MFA.methodField]: input.method,
      [MFA.codeField]: input.code,
    },
  })
  if (!body.token) {
    throw new ApiError(0, "no_token", "The code was not accepted.")
  }
  return body.token
}

// Sign-out drops the in-memory token. There is no server session to end.
export const endSession = (): void => clearToken()

export type Enrolment = { secret: string; otpauthUri: string | null; factorId: string }

export const startEnrolment = async (): Promise<Enrolment> => {
  const body = await fetchJson<unknown>(MFA.factorStart, {
    method: "POST",
    body: { ...MFA.factorStartBody },
  })
  const secret = findSecret(body)
  const factorId = findFactorId(body)
  if (!secret || !factorId) {
    throw new ApiError(0, "enrolment_shape", "Two-factor setup could not be started. Try again.")
  }
  return { secret, otpauthUri: findOtpauthUri(body), factorId }
}

export const verifyEnrolment = async (factorId: string, code: string): Promise<string[]> => {
  const verified = await fetchJson<unknown>(MFA.factorVerify(factorId), {
    method: "POST",
    body: { [MFA.codeField]: code },
  })
  let codes = findRecoveryCodes(verified)
  if (codes.length === 0) {
    const generated = await fetchJson<unknown>(MFA.recoveryCodes, {
      method: "POST",
      body: { ...MFA.recoveryBody },
    })
    codes = findRecoveryCodes(generated)
  }
  return codes
}
