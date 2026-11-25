import {
  CANARY_EMAIL_DOMAIN,
  CANARY_PLUGIN,
  CANARY_VENDORS,
} from "../../src/scripts/demo-data/canary";
import { CATALOG_CANARY_TOKENS } from "./catalog-strings";

export { CANARY_PLUGIN, CANARY_VENDORS };

export type Variant = { variant: string; value: string };

const PHONE = /^[0-9]{10}$/;

export const isPhoneToken = (token: string): boolean => PHONE.test(token);

// Every distinctive value a customer must never see, flattened and de-duplicated.
export const allCanaryTokens = (): string[] => {
  const tokens = new Set<string>();

  for (const vendor of Object.values(CANARY_VENDORS)) {
    tokens.add(vendor.internal_name);
    tokens.add(vendor.contact_name);
    tokens.add(vendor.email);
    tokens.add(vendor.email.split("@")[0]);
    tokens.add(vendor.phone);
    tokens.add(vendor.note);
    tokens.add(vendor.suspend_reason);
    tokens.add(vendor.location.label);
    tokens.add(vendor.location.address_1);
    tokens.add(vendor.location.address_2);
    tokens.add(vendor.location.city);
    tokens.add(vendor.location.pickup_contact_name);
    tokens.add(vendor.location.pickup_contact_phone);
  }

  for (const token of CATALOG_CANARY_TOKENS) {
    tokens.add(token);
  }

  tokens.add(CANARY_PLUGIN.pan);
  tokens.add(CANARY_PLUGIN.gstin);
  tokens.add(CANARY_EMAIL_DOMAIN);

  return [...tokens];
};

const unicodeEscape = (value: string): string =>
  value.replace(
    /[^A-Za-z0-9]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );

// The forms a value takes after an encoder touched it: raw, lower case, percent
// encoding, JSON unicode escapes, HTML entities for the at sign and the usual
// phone formats. The scanner compares them case-insensitively.
export const variantsOf = (token: string): Variant[] => {
  const found: Variant[] = [{ variant: "raw", value: token }];

  const add = (variant: string, value: string) => {
    if (value && !found.some((entry) => entry.value === value)) {
      found.push({ variant, value });
    }
  };

  add("lower-case", token.toLowerCase());
  add("percent-encoded", encodeURIComponent(token));
  add("unicode-escaped", unicodeEscape(token));

  if (token.includes("@")) {
    add("html-decimal-entity", token.replace(/@/g, "&#64;"));
    add("html-hex-entity", token.replace(/@/g, "&#x40;"));
  }

  if (isPhoneToken(token)) {
    add("phone-country-code", `+91${token}`);
    add("phone-spaced-country-code", `+91 ${token.slice(0, 5)} ${token.slice(5)}`);
    add("phone-spaced", `${token.slice(0, 5)} ${token.slice(5)}`);
  }

  return found;
};
