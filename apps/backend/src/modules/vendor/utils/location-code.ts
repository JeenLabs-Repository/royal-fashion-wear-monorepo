import { MedusaError } from "@medusajs/framework/utils";

/** 1 gives LOC-0001, 42 gives LOC-0042, 10000 gives LOC-10000. */
export function formatLocationCode(n: number): string {
  if (!Number.isInteger(n) || n <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A location number must be a positive whole number."
    );
  }
  return `LOC-${String(n).padStart(4, "0")}`;
}
