import { createHmac } from "node:crypto"

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const STEP_SECONDS = 30

const base32Decode = (input: string): Buffer => {
  const clean = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase()
  const bytes: number[] = []
  let value = 0
  let bits = 0
  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
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

// RFC 6238 with HMAC-SHA1, a 30 second step and 6 digits. The same algorithm as
// the backend test helper, kept here so the browser specs need no extra package.
export const totp = (secret: string, atMs: number = Date.now(), digits = 6): string => {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS)
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

export const stepOf = (atMs: number = Date.now()): number => Math.floor(atMs / 1000 / STEP_SECONDS)

// A code that was just accepted can be refused as a replay in the same window.
// This waits for the next 30 second window when the last used step is the current one.
export const freshTotp = async (
  secret: string,
  usedStep?: number
): Promise<{ code: string; step: number }> => {
  if (usedStep !== undefined && stepOf() === usedStep) {
    const wait = STEP_SECONDS * 1000 - (Date.now() % (STEP_SECONDS * 1000)) + 500
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
  const now = Date.now()
  return { code: totp(secret, now), step: stepOf(now) }
}
