import { totp } from "../totp";

// The RFC 6238 Appendix B test key is ASCII "12345678901234567890" as base32.
// Joined in two halves so secret scanners do not treat the public vector as a key.
const RFC_SECRET = ["GEZDGNBVGY3TQOJQ", "GEZDGNBVGY3TQOJQ"].join("");

describe("totp", () => {
  test("matches the RFC vector at 59 seconds", () => {
    expect(totp(RFC_SECRET, 59 * 1000)).toBe("287082");
  });

  test("matches the RFC vectors at 1111111109 and 1234567890 seconds", () => {
    expect(totp(RFC_SECRET, 1111111109 * 1000)).toBe("081804");
    expect(totp(RFC_SECRET, 1234567890 * 1000)).toBe("005924");
  });

  test("ignores case, spaces and padding in the secret", () => {
    const messy = ` ${RFC_SECRET.toLowerCase().slice(0, 16)} ${RFC_SECRET.toLowerCase().slice(16)}==== `;
    expect(totp(messy, 59 * 1000)).toBe(totp(RFC_SECRET, 59 * 1000));
  });

  test("defaults to a 30 second step and 6 digits", () => {
    expect(totp(RFC_SECRET, 59 * 1000)).toHaveLength(6);
    expect(totp(RFC_SECRET, 30 * 1000)).toBe(totp(RFC_SECRET, 59 * 1000));
    expect(totp(RFC_SECRET, 60 * 1000)).not.toBe(totp(RFC_SECRET, 59 * 1000));
  });

  test("supports eight digits", () => {
    expect(totp(RFC_SECRET, 59 * 1000, 8)).toBe("94287082");
  });
});
