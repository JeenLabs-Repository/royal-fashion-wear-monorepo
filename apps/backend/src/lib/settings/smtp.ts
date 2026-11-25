import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createCardReader } from "./card-reader";
import {
  isNotAvailableError,
  isUnknownIdentifierError,
  type OptionsContainer,
} from "./resolve-options";
import {
  isDevelopmentFallbackAllowed,
  readDevSmtpFromEnv,
} from "./smtp-dev-fallback";

export const SMTP_IDENTIFIER = "integration-smtp";

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  from_name: string;
  reply_to: string;
};

export type SmtpSettingsSource = "card" | "dev-env" | "none";

export type SmtpSettingsResult = {
  settings: SmtpSettings;
  source: SmtpSettingsSource;
};

export const SMTP_DEFAULTS: SmtpSettings = {
  host: "",
  port: 587,
  secure: false,
  user: "",
  pass: "",
  from: "",
  from_name: "",
  reply_to: "",
};

type Warn = (message: string) => void;

function textField(
  raw: Record<string, unknown>,
  key: keyof SmtpSettings,
  fallback: string,
  warn: Warn,
  options: { trim: boolean } = { trim: true }
): string {
  const value = raw[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string") {
    warn(`${key} must be text; using the default`);
    return fallback;
  }
  return options.trim ? value.trim() : value;
}

// Each stored value is checked on its own, so one bad field does not discard
// the others. Messages name the field and never the value.
const readCard = createCardReader<SmtpSettings>({
  identifier: SMTP_IDENTIFIER,
  defaults: SMTP_DEFAULTS,
  tag: "smtp",
  parse: (raw, defaults, warn) => {
    let port = defaults.port;
    if (raw.port !== undefined && raw.port !== null) {
      if (
        typeof raw.port === "number" &&
        Number.isInteger(raw.port) &&
        raw.port >= 1 &&
        raw.port <= 65535
      ) {
        port = raw.port;
      } else {
        warn(`port must be a whole number from 1 to 65535; using ${defaults.port}`);
      }
    }

    let secure = defaults.secure;
    if (raw.secure !== undefined && raw.secure !== null) {
      if (typeof raw.secure === "boolean") {
        secure = raw.secure;
      } else {
        warn(`secure must be true or false; using ${String(defaults.secure)}`);
      }
    }

    return {
      host: textField(raw, "host", defaults.host, warn),
      port,
      secure,
      user: textField(raw, "user", defaults.user, warn),
      // The password is kept exactly as stored, spaces included.
      pass: textField(raw, "pass", defaults.pass, warn, { trim: false }),
      from: textField(raw, "from", defaults.from, warn),
      from_name: textField(raw, "from_name", defaults.from_name, warn),
      reply_to: textField(raw, "reply_to", defaults.reply_to, warn),
    };
  },
});

// A log flag only. It is not a settings cache: every call still reads the card.
let fallbackNoticeLogged = false;

/** Lets tests see the once-only notice again. Not used outside tests. */
export function resetSmtpFallbackNoticeForTests(): void {
  fallbackNoticeLogged = false;
}

function noteFallbackOnce(container: OptionsContainer, host: string): void {
  if (fallbackNoticeLogged) {
    return;
  }
  fallbackNoticeLogged = true;
  let logger: { warn: (message: string) => void } | undefined;
  try {
    logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
      warn: (message: string) => void;
    };
  } catch {
    logger = undefined;
  }
  const line = `[smtp] no mail card saved; using the development mail settings for host ${host}`;
  if (logger) {
    logger.warn(line);
  } else {
    console.warn(line);
  }
}

/**
 * Mail settings for one send. The card wins whenever it has a host. Outside
 * production an unconfigured card falls back to the development variables, so
 * the local mail catcher keeps working. In production an unconfigured card
 * yields the defaults and the caller skips the send.
 */
export async function getSmtpSettings(
  container: OptionsContainer
): Promise<SmtpSettingsResult> {
  let card: SmtpSettings;
  try {
    card = await readCard(container);
  } catch (error) {
    // Notification and payment provider cradles may surface the Integration
    // Module registration throw instead of a soft unavailable result. Treat
    // those the same as a missing card so the development fallback can run.
    if (isUnknownIdentifierError(error) || isNotAvailableError(error)) {
      card = SMTP_DEFAULTS;
    } else {
      throw error;
    }
  }

  if (card.host) {
    return { settings: card, source: "card" };
  }

  if (isDevelopmentFallbackAllowed()) {
    const fallback = readDevSmtpFromEnv();
    if (fallback.host) {
      noteFallbackOnce(container, fallback.host);
      return { settings: fallback, source: "dev-env" };
    }
  }

  return { settings: card, source: "none" };
}
