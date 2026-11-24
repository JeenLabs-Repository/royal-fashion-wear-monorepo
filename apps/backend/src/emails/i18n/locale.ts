import { emailMessages } from "./messages";

export type EmailLocale = keyof typeof emailMessages;

export const EMAIL_LOCALES = Object.keys(emailMessages).sort() as EmailLocale[];

export const FALLBACK_EMAIL_LOCALE = "en" as const satisfies EmailLocale;

// Alternate language codes mapped to the code of a catalog, for example
// `no: "nb"`. It is empty while English is the only catalog; adding a language
// later is a catalog file plus, when the language has other codes, an entry here.
const LOCALE_ALIASES: Record<string, string> = {};

function isEmailLocale(value: string): value is EmailLocale {
  return (EMAIL_LOCALES as readonly string[]).includes(value);
}

function matchLocale(candidate: unknown): EmailLocale | undefined {
  if (typeof candidate !== "string") return undefined;

  const normalized = candidate.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) return undefined;

  const aliased = LOCALE_ALIASES[normalized] ?? normalized;
  if (isEmailLocale(aliased)) return aliased;

  const base = aliased.split("-")[0];
  const aliasedBase = LOCALE_ALIASES[base] ?? base;
  return isEmailLocale(aliasedBase) ? aliasedBase : undefined;
}

export const DEFAULT_EMAIL_LOCALE: EmailLocale =
  matchLocale(process.env.STOREFRONT_DEFAULT_LOCALE) ?? FALLBACK_EMAIL_LOCALE;

export function resolveEmailLocale(
  ...candidates: unknown[]
): EmailLocale {
  for (const candidate of candidates) {
    const matched = matchLocale(candidate);
    if (matched) return matched;
  }
  return DEFAULT_EMAIL_LOCALE;
}

export function getLocaleFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  const value = metadata?.locale;
  return typeof value === "string" ? value : undefined;
}
