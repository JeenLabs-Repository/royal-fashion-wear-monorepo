export type IndiaStateOption = {
  /** Lower-case Medusa province, the value saved on an address. */
  value: string
  /** Name shown in the dropdown. */
  label: string
  /** ISO 3166-2:IN code, the same code the backend state table holds. */
  code: string
}

// The 36 states and union territories. A guard compares this list with the
// backend table, so edit both together or the build fails.
export const INDIA_STATES: readonly IndiaStateOption[] = [
  { value: "in-an", label: "Andaman and Nicobar Islands", code: "IN-AN" },
  { value: "in-ap", label: "Andhra Pradesh", code: "IN-AP" },
  { value: "in-ar", label: "Arunachal Pradesh", code: "IN-AR" },
  { value: "in-as", label: "Assam", code: "IN-AS" },
  { value: "in-br", label: "Bihar", code: "IN-BR" },
  { value: "in-ch", label: "Chandigarh", code: "IN-CH" },
  { value: "in-ct", label: "Chhattisgarh", code: "IN-CT" },
  { value: "in-dh", label: "Dadra and Nagar Haveli and Daman and Diu", code: "IN-DH" },
  { value: "in-dl", label: "Delhi", code: "IN-DL" },
  { value: "in-ga", label: "Goa", code: "IN-GA" },
  { value: "in-gj", label: "Gujarat", code: "IN-GJ" },
  { value: "in-hp", label: "Himachal Pradesh", code: "IN-HP" },
  { value: "in-hr", label: "Haryana", code: "IN-HR" },
  { value: "in-jh", label: "Jharkhand", code: "IN-JH" },
  { value: "in-jk", label: "Jammu and Kashmir", code: "IN-JK" },
  { value: "in-ka", label: "Karnataka", code: "IN-KA" },
  { value: "in-kl", label: "Kerala", code: "IN-KL" },
  { value: "in-la", label: "Ladakh", code: "IN-LA" },
  { value: "in-ld", label: "Lakshadweep", code: "IN-LD" },
  { value: "in-mh", label: "Maharashtra", code: "IN-MH" },
  { value: "in-ml", label: "Meghalaya", code: "IN-ML" },
  { value: "in-mn", label: "Manipur", code: "IN-MN" },
  { value: "in-mp", label: "Madhya Pradesh", code: "IN-MP" },
  { value: "in-mz", label: "Mizoram", code: "IN-MZ" },
  { value: "in-nl", label: "Nagaland", code: "IN-NL" },
  { value: "in-od", label: "Odisha", code: "IN-OD" },
  { value: "in-pb", label: "Punjab", code: "IN-PB" },
  { value: "in-py", label: "Puducherry", code: "IN-PY" },
  { value: "in-rj", label: "Rajasthan", code: "IN-RJ" },
  { value: "in-sk", label: "Sikkim", code: "IN-SK" },
  { value: "in-tg", label: "Telangana", code: "IN-TG" },
  { value: "in-tn", label: "Tamil Nadu", code: "IN-TN" },
  { value: "in-tr", label: "Tripura", code: "IN-TR" },
  { value: "in-up", label: "Uttar Pradesh", code: "IN-UP" },
  { value: "in-ut", label: "Uttarakhand", code: "IN-UT" },
  { value: "in-wb", label: "West Bengal", code: "IN-WB" },
]

/** Six digits, the first one not zero. The backend applies the same rule. */
export const PIN_PATTERN = /^[1-9][0-9]{5}$/

/** "IN-MH" becomes "in-mh", the form Medusa stores on an address. */
export function provinceFromStateCode(code: string): string {
  return code.toLowerCase()
}

/** Name for a saved province value, or an empty string for an unknown one. */
export function stateLabel(value: string): string {
  return INDIA_STATES.find((state) => state.value === value)?.label ?? ""
}
