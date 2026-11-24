// The one deny list for anything that could expose where a product ships from
// or who supplies it. The store guard, the serializer audience check and the
// tests all read this file; there is no second copy.
//
// A term is forbidden when any path segment equals a root, a plural of it, or
// a root followed by an underscore suffix (vendor_id, location_levels).
// Matching is anchored per segment, so words that only contain a root
// (allocation, manage_inventory) stay allowed.
export const FORBIDDEN_ROOTS = [
  "vendor",
  "stock_location",
  "location",
  "location_level",
  "inventory_item",
  "inventory",
  "reservation",
  "submission",
  "assignment",
  "routing",
  "courier",
  "awb",
] as const;

// Whole segments that carry a forbidden root in their name but are public data.
export const SEGMENT_EXCEPTIONS = ["inventory_quantity"] as const;

export const MAX_FIELD_PARAM_LENGTH = 4000;

/** Returned in place of a term when a parameter is too long to inspect. */
export const TOO_LONG_MARKER = "<too-long>";

// One anchored expression, one linear scan per segment, no nested quantifiers.
const SEGMENT_PATTERN = new RegExp(
  `^(?:${[...FORBIDDEN_ROOTS].sort((a, b) => b.length - a.length).join("|")})s?(?:_[a-z0-9_]+)?$`
);

const PARAM_KEY = /^(fields|expand|include)(\[[^\]]*\])*$/i;

export function isForbiddenSegment(segment: string): boolean {
  const lower = segment.trim().toLowerCase();
  if ((SEGMENT_EXCEPTIONS as readonly string[]).includes(lower)) {
    return false;
  }
  return SEGMENT_PATTERN.test(lower);
}

/**
 * Splits a raw `fields`, `expand` or `include` value on commas, strips the
 * `+`, `-` and `*` prefixes and whitespace, and returns the first term that
 * has a forbidden path segment, exactly as the caller wrote it. Returns null
 * for a safe value.
 */
export function findForbiddenTerm(raw: string): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  if (raw.length > MAX_FIELD_PARAM_LENGTH) {
    return TOO_LONG_MARKER;
  }
  for (const part of raw.split(",")) {
    const term = part.trim();
    if (!term) {
      continue;
    }
    const path = term.replace(/^[+\-*\s]+/, "");
    if (path.split(".").some(isForbiddenSegment)) {
      return term;
    }
  }
  return null;
}

/** Values of `fields`, `expand`, `include` and their `[]` and `[n]` forms, in URL order. */
export function collectFieldTerms(params: URLSearchParams): string[] {
  const values: string[] = [];
  for (const [key, value] of params.entries()) {
    if (PARAM_KEY.test(key)) {
      values.push(value);
    }
  }
  return values;
}
