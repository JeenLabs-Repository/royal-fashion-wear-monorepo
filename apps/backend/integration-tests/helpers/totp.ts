import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// RFC 4648 base32. Case, spaces and "=" padding are ignored.
const decodeBase32 = (input: string): Buffer => {
  const clean = input.replace(/[\s=]/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error(`Not a base32 character: "${character}"`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
};

/**
 * RFC 6238 time-based one-time code with HMAC-SHA1. Used by tests and by the
 * browser-automation helper to answer a two-step sign-in challenge.
 */
export const totp = (
  secretBase32: string,
  atMs: number = Date.now(),
  digits: number = 6,
  stepSeconds: number = 30
): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / stepSeconds)));
  const hmac = createHmac("sha1", decodeBase32(secretBase32))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
};
