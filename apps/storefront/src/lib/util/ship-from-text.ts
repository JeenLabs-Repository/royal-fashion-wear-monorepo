// Pure text builder for the ship-from line. It has no imports so it runs under
// `node --test` without a build step.

export type ShipFromState = { code: string; name: string }

export type ShipFromLabels = {
  /** Wraps the joined state names, for example "Ships from {states}". */
  shipFrom: (statesText: string) => string
  /** Used when four or more states ship the product. */
  multiple: string
  /** The word between the last two names, for example "and". */
  and: string
}

const MAX_LISTED = 3

/**
 * One to three states are listed by name in alphabetical order, four or more
 * collapse to the "multiple" label, and no state gives `null` so the page
 * renders nothing.
 */
export function buildShipFromText(
  states: ShipFromState[],
  labels: ShipFromLabels
): string | null {
  const byCode = new Map<string, string>()
  for (const state of states) {
    if (state.code && state.name) byCode.set(state.code, state.name)
  }

  const names = Array.from(byCode.values()).sort((a, b) =>
    a.localeCompare(b, "en")
  )

  if (names.length === 0) return null
  if (names.length > MAX_LISTED) return labels.multiple
  if (names.length === 1) return labels.shipFrom(names[0])

  const head = names.slice(0, -1).join(", ")
  return labels.shipFrom(`${head} ${labels.and} ${names[names.length - 1]}`)
}
