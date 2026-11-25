import { createCardReader } from "./card-reader";

export const CUSTOMER_IDENTITY_IDENTIFIER = "integration-customer-identity";

export const LM_DISPLAY_MODES = ["hidden", "owner_marketer", "product_declared"] as const;

export type LmDisplayMode = (typeof LM_DISPLAY_MODES)[number];

export type CustomerIdentitySettings = {
  /** What the storefront shows as the party responsible for a product */
  lm_display_mode: LmDisplayMode;
  /** The owner's marketed-by line, used in owner_marketer mode */
  lm_marketer_text: string;
};

// Nothing is shown unless the owner saved and enabled the card.
export const CUSTOMER_IDENTITY_DEFAULTS: CustomerIdentitySettings = {
  lm_display_mode: "hidden",
  lm_marketer_text: "",
};

const MAX_MARKETER_TEXT = 200;

const isMode = (value: unknown): value is LmDisplayMode =>
  typeof value === "string" && (LM_DISPLAY_MODES as readonly string[]).includes(value);

/**
 * Customer identity settings, read at call time on every call. Each field
 * falls back to its default on its own, with a warning. Only the two keys
 * above are read; any other option on the card is ignored.
 */
export const getCustomerIdentitySettings = createCardReader<CustomerIdentitySettings>({
  identifier: CUSTOMER_IDENTITY_IDENTIFIER,
  defaults: CUSTOMER_IDENTITY_DEFAULTS,
  tag: "settings",
  parse: (raw, defaults, warn) => {
    let mode = defaults.lm_display_mode;
    const storedMode = raw.lm_display_mode;
    if (storedMode !== undefined) {
      if (isMode(storedMode)) {
        mode = storedMode;
      } else {
        warn(`lm_display_mode is not a valid mode; using ${defaults.lm_display_mode}`);
      }
    }

    let text = defaults.lm_marketer_text;
    const storedText = raw.lm_marketer_text;
    if (storedText !== undefined) {
      const trimmed = typeof storedText === "string" ? storedText.trim() : null;
      if (trimmed !== null && trimmed.length <= MAX_MARKETER_TEXT) {
        text = trimmed;
      } else {
        warn(
          `lm_marketer_text must be text of at most ${MAX_MARKETER_TEXT} characters; using an empty line`
        );
      }
    }

    return { lm_display_mode: mode, lm_marketer_text: text };
  },
});
