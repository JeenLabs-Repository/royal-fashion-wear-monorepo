import { parseAlertEmails } from "./break-glass/parse-alert-emails";

// Rules that decide whether the backend may start in production.
//
// Everything here is a plain function with no Medusa imports and no work at
// import time, so the config file and the tests can both use it.

export const MIN_SECRET_LENGTH = 32;

// Secrets the backend signs or encrypts with. Each one has to be set, not a
// well-known value, and at least MIN_SECRET_LENGTH characters long.
export const REQUIRED_SECRET_KEYS = [
  "JWT_SECRET",
  "COOKIE_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
  "AUTH_MFA_ENCRYPTION_KEY",
  "REVALIDATE_SECRET",
] as const;

// Values that look like a secret but are public knowledge. Compared in lower
// case; anything starting with "dev-only" counts as well.
export const PLACEHOLDER_VALUES = new Set([
  "supersecret",
  "replace-me",
  "changeme",
  "change-me",
  "secret",
  "password",
  "",
]);

// Used for the signing secrets in development when nothing is set. The check
// above rejects it in production.
export const DEV_FALLBACK_SECRET = "dev-only-not-for-production";

const CORS_KEYS = ["STORE_CORS", "ADMIN_CORS", "AUTH_CORS"] as const;
const DOCS_HOST = "docs.medusajs.com";
const VENDOR_HOST_SUFFIX = "gorgojs.com";

type Env = Record<string, string | undefined>;

export type ProductionConfigIssue = {
  key: string;
  problem:
    | "unset"
    | "placeholder"
    | "too-short"
    | "not-true"
    | "invalid-url"
    | "vendor-host"
    | "docs-origin"
    | "invalid-email";
  message: string;
};

const isPlaceholder = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_VALUES.has(normalized) || normalized.startsWith("dev-only");
};

const issue = (
  key: string,
  problem: ProductionConfigIssue["problem"],
  message: string
): ProductionConfigIssue => ({ key, problem, message });

// Returns every problem found, never the values that caused them.
export const collectConfigIssues = (env: Env): ProductionConfigIssue[] => {
  const issues: ProductionConfigIssue[] = [];

  for (const key of REQUIRED_SECRET_KEYS) {
    const value = (env[key] ?? "").trim();
    if (value === "") {
      issues.push(issue(key, "unset", "is not set"));
    } else if (isPlaceholder(value)) {
      issues.push(
        issue(key, "placeholder", "is a placeholder or well-known value")
      );
    } else if (value.length < MIN_SECRET_LENGTH) {
      issues.push(
        issue(
          key,
          "too-short",
          `is shorter than ${MIN_SECRET_LENGTH} characters`
        )
      );
    }
  }

  // The config forces secure cookies in production, so the variable only has to
  // stay out of the way: unset or "true".
  const cookieSecure = env.COOKIE_SECURE;
  if (cookieSecure !== undefined && cookieSecure.trim() !== "true") {
    issues.push(
      issue(
        "COOKIE_SECURE",
        "not-true",
        "must be true or unset in production"
      )
    );
  }

  for (const key of ["REDIS_URL", "DATABASE_URL"] as const) {
    if ((env[key] ?? "").trim() === "") {
      issues.push(issue(key, "unset", "is not set"));
    }
  }

  const storefrontUrl = (env.STOREFRONT_URL ?? "").trim();
  if (storefrontUrl === "") {
    issues.push(issue("STOREFRONT_URL", "unset", "is not set"));
  } else {
    try {
      const { hostname } = new URL(storefrontUrl);
      if (
        hostname === VENDOR_HOST_SUFFIX ||
        hostname.endsWith(`.${VENDOR_HOST_SUFFIX}`)
      ) {
        issues.push(
          issue(
            "STOREFRONT_URL",
            "vendor-host",
            "points at the template vendor's host, not this store"
          )
        );
      }
    } catch {
      issues.push(
        issue("STOREFRONT_URL", "invalid-url", "is not a valid URL")
      );
    }
  }

  for (const key of CORS_KEYS) {
    const value = (env[key] ?? "").trim();
    if (value === "") {
      issues.push(issue(key, "unset", "is not set"));
    } else if (
      value
        .split(",")
        .some((origin) => origin.trim().toLowerCase().includes(DOCS_HOST))
    ) {
      issues.push(
        issue(
          key,
          "docs-origin",
          "lists the Medusa documentation site as an allowed origin"
        )
      );
    }
  }

  if ((env.GORGO_DISABLE_TELEMETRY ?? "").trim() !== "true") {
    issues.push(
      issue(
        "GORGO_DISABLE_TELEMETRY",
        "not-true",
        "must be true in production"
      )
    );
  }

  // The owner is told by email when the break-glass account is used, so the list
  // needs at least one address and every entry has to be valid.
  const alertEmails = parseAlertEmails(env.BREAK_GLASS_ALERT_EMAILS);
  if (alertEmails.valid.length === 0 && alertEmails.invalid.length === 0) {
    issues.push(issue("BREAK_GLASS_ALERT_EMAILS", "unset", "is not set"));
  } else if (alertEmails.invalid.length > 0) {
    issues.push(
      issue("BREAK_GLASS_ALERT_EMAILS", "invalid-email", "lists an entry that is not a valid email address")
    );
  }

  return issues;
};

// Throws one error listing every problem by variable name. Does nothing outside
// production, where weak values are only reported by warnWeakConfig.
export const assertProductionConfig = (env: Env = process.env): void => {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const issues = collectConfigIssues(env);
  if (issues.length === 0) {
    return;
  }

  const lines = issues.map((found) => `  - ${found.key} ${found.message}`);
  // This runs before Medusa has started, so a plain Error is the right type.
  // eslint-disable-next-line @medusajs/use-medusa-error-not-generic-error
  throw new Error(`Refusing to start in production:\n${lines.join("\n")}`);
};

// Development and test keep working with weak values; this only says so once.
export const warnWeakConfig = (
  env: Env,
  warn: (message: string) => void
): void => {
  if (env.NODE_ENV === "production") {
    return;
  }

  const weak = REQUIRED_SECRET_KEYS.filter((key) => {
    const value = (env[key] ?? "").trim();
    return (
      value !== "" &&
      (isPlaceholder(value) || value.length < MIN_SECRET_LENGTH)
    );
  });

  if (weak.length > 0) {
    warn(
      `[config] weak or placeholder values for ${weak.join(", ")}. Fine for development, refused in production.`
    );
  }
};
