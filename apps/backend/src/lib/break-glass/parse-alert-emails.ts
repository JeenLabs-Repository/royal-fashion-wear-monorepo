// Reads the list of addresses that are told when the break-glass account is
// used. Plain functions with no Medusa imports, so the production start-up
// check can use them too.

const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export type ParsedAlertEmails = { valid: string[]; invalid: string[] };

/** Splits a comma-separated list, trims, lower-cases and de-duplicates. */
export function parseAlertEmails(raw: string | null | undefined): ParsedAlertEmails {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const piece of (raw ?? "").split(",")) {
    const entry = piece.trim().toLowerCase();
    if (entry === "") {
      continue;
    }
    if (!ADDRESS.test(entry)) {
      if (!invalid.includes(entry)) {
        invalid.push(entry);
      }
      continue;
    }
    if (!valid.includes(entry)) {
      valid.push(entry);
    }
  }
  return { valid, invalid };
}

export function getBreakGlassAlertRecipients(
  env: Record<string, string | undefined> = process.env
): string[] {
  return parseAlertEmails(env.BREAK_GLASS_ALERT_EMAILS).valid;
}
