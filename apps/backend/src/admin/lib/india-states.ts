import { STATES } from "../../lib/geo-india/states";

export type StateOption = { value: string; label: string };

// Value is the ISO 3166-2 code the API expects, label is the state name.
export const STATE_OPTIONS: StateOption[] = STATES.map((state) => ({
  value: state.code,
  label: state.name,
})).sort((a, b) => a.label.localeCompare(b.label));

export const stateName = (code: string): string =>
  STATE_OPTIONS.find((state) => state.value === code)?.label ?? code;
