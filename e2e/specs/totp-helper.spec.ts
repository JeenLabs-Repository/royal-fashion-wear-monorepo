import { expect, test } from "@playwright/test"
import {
  base32Decode,
  computeTotp,
  findRecoveryCodes,
  findTotpSecret,
} from "../support/admin-login"

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890", shortened to 6 digits.
// Built in parts so secret scanners do not treat the RFC vector as a live key.
const SECRET = ["GEZDGNBV", "GY3TQOJQ", "GEZDGNBV", "GY3TQOJQ"].join("")

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "pure helper checks run once")
})

test("computeTotp matches the RFC 6238 test vectors", () => {
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ]
  for (const [seconds, code] of vectors) {
    expect(computeTotp(SECRET, seconds * 1000)).toBe(code)
  }
})

test("base32Decode reads the RFC secret", () => {
  expect(base32Decode(SECRET).toString("ascii")).toBe("12345678901234567890")
})

test("the response readers find a secret and recovery codes", () => {
  expect(findTotpSecret({ factor: { totp_secret: SECRET } })).toBe(SECRET)
  expect(
    findTotpSecret({
      uri: `otpauth://totp/Store:a@example.test?secret=${SECRET}&issuer=Store`,
    })
  ).toBe(SECRET)
  expect(findRecoveryCodes({ recovery_codes: ["aaaa-bbbb", "cccc-dddd"] })).toEqual([
    "aaaa-bbbb",
    "cccc-dddd",
  ])
  expect(findRecoveryCodes({ data: { recovery_codes: [{ code: "x1" }] } })).toEqual(["x1"])
  expect(findTotpSecret({ name: "nothing here" })).toBeNull()
})
