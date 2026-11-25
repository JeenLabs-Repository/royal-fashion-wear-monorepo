import { randomInt } from "node:crypto";
import { MedusaError } from "@medusajs/framework/utils";

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const MAX_SLUG_LENGTH = 60;
const MAX_SKU_NUMBER = 99_999_999;

/**
 * Lower-case slug of a title. Non-ASCII characters are dropped, every other
 * run of non-alphanumeric characters becomes one dash, and the result is at
 * most 60 characters with no leading or trailing dash. A title with nothing
 * usable gives "item".
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    // eslint-disable-next-line no-control-regex -- the range starts at NUL on purpose: it keeps ASCII only
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  return slug === "" ? "item" : slug;
}

/** Random lower-case base32 text from the secure random source of the runtime. */
export function randomBase32(length: number): string {
  if (!Number.isInteger(length) || length < 1 || length > 64) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Random text length must be a whole number from 1 to 64.",
      "invalid_random_length"
    );
  }
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += BASE32_ALPHABET[randomInt(BASE32_ALPHABET.length)];
  }
  return out;
}

/** Public product handle: the slug of the approved title, a dash and 5 random characters. */
export function buildHandle(title: string): string {
  return `${slugifyTitle(title)}-${randomBase32(5)}`;
}

/** Platform SKU: "PL-" plus an 8-digit zero-padded counter value. Overflow is loud. */
export function formatPlatformSku(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SKU_NUMBER) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The platform SKU counter is outside 1 to 99,999,999.",
      "sku_counter_out_of_range"
    );
  }
  return `PL-${String(value).padStart(8, "0")}`;
}
