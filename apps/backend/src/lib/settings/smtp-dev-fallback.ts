import type { SmtpSettings } from "./smtp";

// The only place in the app that reads mail settings from the environment.
// It exists so the local mail catcher keeps working in development and in
// tests without anyone filling in a card. Production never uses it: there the
// card is the single source, so the dashboard and the runtime cannot disagree.

const DEFAULT_PORT = 587;

export function isDevelopmentFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function readDevSmtpFromEnv(): SmtpSettings {
  const port = Number(process.env.SMTP_PORT);

  return {
    host: (process.env.SMTP_HOST ?? "").trim(),
    port:
      Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT,
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "",
    from_name: process.env.STORE_NAME ?? "",
    reply_to: process.env.SMTP_REPLY_TO ?? "",
  };
}
