// Removes secrets from anything headed for the audit table. A key counts as
// sensitive when any word inside it (split on punctuation and on camelCase)
// equals one of the words below, so apiKey, x-api-key and refresh_token are
// all caught. Sensitive values become "[redacted]".
const SENSITIVE_WORDS = new Set([
  "password",
  "token",
  "secret",
  "key",
  "otp",
  "code",
  "authorization",
  "cookie",
  "credentials",
]);

// Ordinary data fields whose names happen to contain a sensitive word.
const NEVER_REDACT = new Set([
  "role_key",
  "country_code",
  "currency_code",
  "state_code",
  "postal_code",
]);

const MAX_DEPTH = 6;
const MAX_STRING = 500;
const MAX_JSON_LENGTH = 16384;
const MAX_PATHS = 200;

const words = (key: string): string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

export const isSensitiveKey = (key: string): boolean =>
  !NEVER_REDACT.has(key) &&
  words(key).some((word) => SENSITIVE_WORDS.has(word));

const redactValue = (value: unknown, depth: number): unknown => {
  if (value === null || value === undefined) {
    return value;
  }
  switch (typeof value) {
    case "string":
      return value.length > MAX_STRING
        ? `${value.slice(0, MAX_STRING)}...[truncated]`
        : value;
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
    case "symbol":
      return undefined;
    default:
      break;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (depth >= MAX_DEPTH) {
    return "[max-depth]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (isSensitiveKey(key)) {
      out[key] = "[redacted]";
      continue;
    }
    const redacted = redactValue(child, depth + 1);
    if (redacted !== undefined) {
      out[key] = redacted;
    }
  }
  return out;
};

/**
 * Returns a redacted copy. Depth stops at 6 levels, strings stop at 500
 * characters, and a result longer than 16384 characters once serialized is
 * replaced by { _truncated: true, keys: [sorted top-level key names] }.
 */
export function redactAudit(value: unknown): unknown {
  const result = redactValue(value, 0);
  if (result === undefined) {
    return result;
  }
  const serialized = JSON.stringify(result);
  if (serialized !== undefined && serialized.length > MAX_JSON_LENGTH) {
    const keys =
      result && typeof result === "object" && !Array.isArray(result)
        ? Object.keys(result as Record<string, unknown>).sort()
        : [];
    return { _truncated: true, keys };
  }
  return result;
}

/**
 * Key names only, as sorted dotted paths, to the given depth. Arrays of
 * objects contribute `name[].child`. Values are never read into the result.
 */
export function extractKeyPaths(value: unknown, depth = 2): string[] {
  const paths = new Set<string>();

  const walk = (node: unknown, prefix: string, remaining: number) => {
    if (remaining <= 0 || node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, prefix, remaining);
      }
      return;
    }
    for (const [key, child] of Object.entries(
      node as Record<string, unknown>
    )) {
      if (paths.size >= MAX_PATHS) {
        return;
      }
      const path = prefix ? `${prefix}.${key}` : key;
      paths.add(path);
      if (Array.isArray(child)) {
        walk(child, `${path}[]`, remaining - 1);
      } else {
        walk(child, path, remaining - 1);
      }
    }
  };

  walk(value, "", depth);
  return [...paths].sort();
}
