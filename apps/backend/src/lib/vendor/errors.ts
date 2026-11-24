import { MedusaError } from "@medusajs/framework/utils";

/**
 * The one answer for an unknown, used, expired or otherwise unusable
 * invitation. The text and the code never change with the reason, so a caller
 * learns nothing from the difference.
 */
export function invalidInviteError(): MedusaError {
  return new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "This invitation link cannot be used. Ask the store for a new invitation.",
    "invalid_invite"
  );
}

export function invalidPasswordError(): MedusaError {
  return new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "Password must be 12 to 128 characters.",
    "invalid_password"
  );
}
