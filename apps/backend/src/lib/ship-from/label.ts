export type ShipFromState = { code: string; name: string };

export const MULTIPLE_STATES_LABEL = "Ships from multiple states";

/** Collapses duplicates by code and sorts by name. */
export function normalizeStates(states: ShipFromState[]): ShipFromState[] {
  const byCode = new Map<string, ShipFromState>();
  for (const state of states) {
    if (!byCode.has(state.code)) {
      byCode.set(state.code, { code: state.code, name: state.name });
    }
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/**
 * The only text a customer sees about where a product ships from. No states gives
 * null, one to three are named alphabetically, four or more collapse to one phrase.
 */
export function formatShipFromLabel(states: ShipFromState[]): string | null {
  const names = normalizeStates(states).map((state) => state.name);
  if (names.length === 0) {
    return null;
  }
  if (names.length >= 4) {
    return MULTIPLE_STATES_LABEL;
  }
  if (names.length === 1) {
    return `Ships from ${names[0]}`;
  }
  if (names.length === 2) {
    return `Ships from ${names[0]} and ${names[1]}`;
  }
  return `Ships from ${names[0]}, ${names[1]} and ${names[2]}`;
}
