import { MedusaError } from "@medusajs/framework/utils";

// Amounts are decimal rupees held as strings, so no float is ever created.
// `scaled` is the amount times 100. Paise exist only at the payment boundary.
const RUPEES_PATTERN = /^(\d{1,6})(?:\.(\d{1,2}))?$/;
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;
const MIN_SCALED = 1n;
const MAX_SCALED = 99_999_999n;

const toScaled = (integer: string, fraction: string | undefined): bigint =>
  BigInt(integer) * 100n + BigInt((fraction ?? "").padEnd(2, "0"));

const invalidAmount = (): MedusaError =>
  new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "Enter an amount from 0.01 to 999,999.99 with at most two decimals.",
    "invalid_amount"
  );

/** True when the input is a valid rupee amount string. Never throws. */
export function isRupees(input: unknown): boolean {
  try {
    parseRupees(input);
    return true;
  } catch {
    return false;
  }
}

/** Validates a rupee amount and returns it with exactly two decimals. */
export function parseRupees(input: unknown): string {
  if (typeof input !== "string") {
    throw invalidAmount();
  }
  const match = RUPEES_PATTERN.exec(input);
  if (!match) {
    throw invalidAmount();
  }
  const scaled = toScaled(match[1], match[2]);
  if (scaled < MIN_SCALED || scaled > MAX_SCALED) {
    throw invalidAmount();
  }
  const whole = scaled / 100n;
  const cents = scaled % 100n;
  return `${whole}.${String(cents).padStart(2, "0")}`;
}

/** Compares two decimal strings with at most two decimals, without floats. */
export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  const parse = (value: string): bigint => {
    const match = DECIMAL_PATTERN.exec(value);
    if (!match) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A decimal amount with at most two decimals is required.",
        "invalid_amount"
      );
    }
    return toScaled(match[1], match[2]);
  };
  const left = parse(a);
  const right = parse(b);
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
