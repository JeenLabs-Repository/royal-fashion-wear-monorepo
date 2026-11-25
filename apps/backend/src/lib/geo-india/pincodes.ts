import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PinDirectory } from "./pincode-build";

export const PIN_PATTERN = /^[1-9][0-9]{5}$/;

export type PinLookup = {
  state_code: string;
  district: string;
  city: string;
  localities: string[];
};

let index: PinDirectory | null = null;
let loads = 0;

// The file sits next to this module in source and, after the build copy step, in the
// compiled output. It is parsed once on first use and kept in memory.
function load(): PinDirectory {
  if (!index) {
    index = JSON.parse(readFileSync(join(__dirname, "pincodes.json"), "utf8")) as PinDirectory;
    loads += 1;
  }
  return index;
}

/** How many times the file has been parsed. Used by the unit test only. */
export function pincodeLoadCount(): number {
  return loads;
}

/** Returns null for a malformed or unknown PIN. Never throws for bad input. */
export function lookupPin(pin: string): PinLookup | null {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return null;
  }
  const entry = load().pins[pin];
  if (!entry) {
    return null;
  }
  const [stateCode, district, offices] = entry;
  return {
    state_code: stateCode,
    district,
    city: district,
    localities: offices.slice(0, 5),
  };
}

export function isKnownPin(pin: string): boolean {
  return lookupPin(pin) !== null;
}

export function getPincodeDirectoryMeta(): { generated_at: string; count: number } {
  const { generated_at, count } = load();
  return { generated_at, count };
}
