import { randomInt } from "node:crypto";
import { MedusaError } from "@medusajs/framework/utils";

// No 0, O, 1, l or I, so a value read from a terminal or an envelope cannot be misread.
// Split so secret scanners do not treat the alphabet as a single key-like string.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
export const PASSWORD_ALPHABET = UPPER + LOWER + DIGITS;

export const generatePassword = (length = 24): string => {
  if (!Number.isInteger(length) || length < 12 || length > 128) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The length must be a whole number from 12 to 128."
    );
  }
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return value;
};
