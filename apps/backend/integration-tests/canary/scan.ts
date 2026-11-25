import { allCanaryTokens, variantsOf } from "./canary-strings";

export type Finding = {
  token: string;
  variant: string;
  offset: number;
  excerpt: string;
  label: string;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const decodePercent = (text: string): string =>
  text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });

const decodeUnicode = (text: string): string =>
  text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) {
      return String.fromCodePoint(parseInt(body.slice(1), 10));
    }
    return NAMED_ENTITIES[body] ?? match;
  });

// Two rounds catch a value that was encoded twice.
export const decodeAll = (text: string): string => {
  let current = text;
  for (let round = 0; round < 2; round += 1) {
    current = decodeEntities(decodeUnicode(decodePercent(current)));
  }
  return current;
};

// Never the whole body: a window of 40 characters around the hit.
const excerptAt = (text: string, offset: number): string => {
  const start = Math.max(0, offset - 10);
  return text.slice(start, start + 40).replace(/\s+/g, " ");
};

// Reports at most one finding per token. Raw text is searched for every variant
// of the token; the decoded text is searched for the plain token, which catches
// values that an encoder hid.
export const scanText = (text: string, label: string): Finding[] => {
  const findings: Finding[] = [];
  const lowerRaw = text.toLowerCase();
  const decoded = decodeAll(text);
  const lowerDecoded = decoded.toLowerCase();

  for (const token of allCanaryTokens()) {
    let found = false;

    for (const { variant, value } of variantsOf(token)) {
      const offset = lowerRaw.indexOf(value.toLowerCase());
      if (offset >= 0) {
        findings.push({ token, variant, offset, excerpt: excerptAt(text, offset), label });
        found = true;
        break;
      }
    }

    if (!found && lowerDecoded !== lowerRaw) {
      const offset = lowerDecoded.indexOf(token.toLowerCase());
      if (offset >= 0) {
        findings.push({ token, variant: "decoded", offset, excerpt: excerptAt(decoded, offset), label });
      }
    }
  }

  return findings;
};

export const formatFinding = (finding: Finding): string =>
  `${finding.label}: "${finding.token}" as ${finding.variant} at ${finding.offset} near "${finding.excerpt}"`;

export const assertNoCanary = (text: string, label: string): void => {
  const findings = scanText(text, label);
  if (findings.length > 0) {
    const shown = findings.slice(0, 3).map(formatFinding).join("\n");
    const more = findings.length > 3 ? `\n...and ${findings.length - 3} more` : "";
    throw new Error(`Vendor canary found in ${label}:\n${shown}${more}`);
  }
};
