export const GST_CLASSES = ["GST-0", "GST-5", "GST-18", "GST-40", "not_sure"] as const;

export type GstClass = (typeof GST_CLASSES)[number];

const HSN_PATTERN = /^(\d{4}|\d{6}|\d{8})$/;

/** An HSN code has 4, 6 or 8 digits and nothing else. */
export function isValidHsn(value: unknown): boolean {
  return typeof value === "string" && HSN_PATTERN.test(value);
}
