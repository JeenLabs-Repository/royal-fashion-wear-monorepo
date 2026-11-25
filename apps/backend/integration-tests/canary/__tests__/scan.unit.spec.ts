import { allCanaryTokens, variantsOf } from "../canary-strings";
import { CANARY_PLUGIN, CANARY_VENDORS } from "../../../src/scripts/demo-data/canary";
import { assertNoCanary, scanText } from "../scan";

const alpha = CANARY_VENDORS.alpha;
const email = alpha.email;
const phone = alpha.phone;

describe("scanText", () => {
  it("finds a token in raw text", () => {
    const findings = scanText(`<p>${alpha.internal_name}</p>`, "raw");
    expect(findings.map((finding) => finding.token)).toContain(alpha.internal_name);
    expect(findings[0].variant).toBe("raw");
  });

  it("finds a token in lower case", () => {
    const findings = scanText(alpha.internal_name.toLowerCase(), "lower");
    expect(findings.map((finding) => finding.token)).toContain(alpha.internal_name);
  });

  it("finds a percent-encoded email", () => {
    const findings = scanText(`mailto:${encodeURIComponent(email)}`, "percent");
    expect(findings.some((finding) => finding.token === email)).toBe(true);
    expect(findings.find((finding) => finding.token === email)?.variant).toBe("percent-encoded");
  });

  it("finds a JSON unicode-escaped email", () => {
    const findings = scanText('{"e":"cnry-alpha-7qx\\u0040canary.invalid"}', "unicode");
    expect(findings.some((finding) => finding.token === email)).toBe(true);
  });

  it("finds an email written as decimal HTML entities", () => {
    const findings = scanText("<a>cnry-alpha-7qx&#64;canary.invalid</a>", "entity-dec");
    expect(findings.some((finding) => finding.token === email)).toBe(true);
  });

  it("finds an email written as hex HTML entities", () => {
    const findings = scanText("<a>cnry-alpha-7qx&#x40;canary.invalid</a>", "entity-hex");
    expect(findings.some((finding) => finding.token === email)).toBe(true);
  });

  it("finds a value that only a decoder reveals", () => {
    const hidden = alpha.location.city.replace("-", "%2D");
    const findings = scanText(`x ${hidden} y`, "decoded");
    expect(findings.map((finding) => finding.token)).toContain(alpha.location.city);
    expect(findings.find((finding) => finding.token === alpha.location.city)?.variant).toBe("decoded");
  });

  it.each([
    ["plain digits", phone],
    ["country code", `+91${phone}`],
    ["spaced with country code", `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`],
    ["spaced", `${phone.slice(0, 5)} ${phone.slice(5)}`],
  ])("finds the phone number as %s", (_name, text) => {
    const findings = scanText(`call ${text} today`, "phone");
    expect(findings.some((finding) => finding.token === phone)).toBe(true);
  });

  it("returns an empty list for clean text", () => {
    expect(scanText("<html><body>Ships from Maharashtra</body></html>", "clean")).toEqual([]);
  });

  it("reports the token, variant, offset and a short excerpt, never the whole body", () => {
    const body = `${"x".repeat(5000)}${alpha.internal_name}${"y".repeat(5000)}`;
    const [finding] = scanText(body, "long");
    expect(finding.token).toBe(alpha.internal_name);
    expect(finding.offset).toBe(5000);
    expect(finding.excerpt.length).toBeLessThanOrEqual(40);
    expect(finding.excerpt.length).toBeLessThan(body.length);
  });

  it("finds the fake plugin identifiers", () => {
    expect(scanText(`pan ${CANARY_PLUGIN.pan}`, "plugin").map((f) => f.token)).toContain(CANARY_PLUGIN.pan);
    expect(scanText(`gstin ${CANARY_PLUGIN.gstin}`, "plugin").map((f) => f.token)).toContain(
      CANARY_PLUGIN.gstin
    );
  });
});

describe("assertNoCanary", () => {
  it("passes for clean text", () => {
    expect(() => assertNoCanary("nothing here", "clean")).not.toThrow();
  });

  it("throws and lists at most three findings", () => {
    const body = [
      alpha.internal_name,
      alpha.contact_name,
      alpha.note,
      alpha.location.label,
      alpha.location.address_1,
    ].join(" ");
    let message = "";
    try {
      assertNoCanary(body, "five-leaks");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("five-leaks");
    expect(message).toContain("more");
    const listed = message.split("\n").filter((line) => line.startsWith("five-leaks:"));
    expect(listed).toHaveLength(3);
  });
});

describe("canary tokens and variants", () => {
  it("includes the plugin placeholder tokens", () => {
    const tokens = allCanaryTokens();
    expect(tokens).toContain("CNRYP9999X");
    expect(tokens).toContain("29CNRYP9999X1Z5");
  });

  it("holds unique tokens for every vendor field", () => {
    const tokens = allCanaryTokens();
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens.length).toBeGreaterThan(30);
  });

  it("builds the four phone formats for a phone token", () => {
    const values = variantsOf(phone).map((entry) => entry.value);
    expect(values).toEqual(
      expect.arrayContaining([phone, `+91${phone}`, "+91 99900 17001", "99900 17001"])
    );
  });

  it("builds entity forms only for tokens with an at sign", () => {
    expect(variantsOf(email).map((entry) => entry.variant)).toEqual(
      expect.arrayContaining(["html-decimal-entity", "html-hex-entity", "percent-encoded"])
    );
    expect(variantsOf(alpha.contact_name).map((entry) => entry.variant)).not.toContain("html-decimal-entity");
  });
});
