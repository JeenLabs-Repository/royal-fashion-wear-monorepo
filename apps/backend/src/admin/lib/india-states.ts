import statesData from "../../lib/geo-india/states-data.json";

export type StateOption = { value: string; label: string };

// Value is the ISO 3166-2 code the API expects, label is the state name.
// Import the JSON table directly so the admin bundle never pulls Node-only
// framework utilities that ship with the TypeScript states module.
export const STATE_OPTIONS: StateOption[] = (
  statesData as { code: string; name: string }[]
)
  .map((state) => ({
    value: state.code,
    label: state.name,
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

export const stateName = (code: string): string =>
  STATE_OPTIONS.find((state) => state.value === code)?.label ?? code;
