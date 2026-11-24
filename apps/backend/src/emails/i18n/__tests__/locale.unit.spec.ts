import {
  EMAIL_LOCALES,
  FALLBACK_EMAIL_LOCALE,
  resolveEmailLocale,
} from "../locale";
import { getEmailTranslator } from "../translator";

describe("email locales", () => {
  it("offers english only", () => {
    expect(EMAIL_LOCALES).toEqual(["en"]);
    expect(FALLBACK_EMAIL_LOCALE).toBe("en");
  });

  it("falls back to english for a language without a catalog", () => {
    expect(resolveEmailLocale("hi")).toBe("en");
  });

  it("resolves a regional code to its base language", () => {
    expect(resolveEmailLocale("en-IN")).toBe("en");
  });

  it("skips unusable candidates and ends on english", () => {
    expect(resolveEmailLocale(undefined, "de", "en")).toBe("en");
  });
});

describe("email translator", () => {
  it("returns the helpers and no text direction", () => {
    const translator = getEmailTranslator("en");

    expect(typeof translator.t).toBe("function");
    expect(typeof translator.html).toBe("function");
    expect(typeof translator.money).toBe("function");
    expect(translator.locale).toBe("en");
    expect("dir" in translator).toBe(false);
  });

  it("returns the english text for a key in the catalog", () => {
    expect(getEmailTranslator("en").t("Common.total")).toBe("Total");
  });

  it("returns the key itself when the catalog has no such key", () => {
    expect(getEmailTranslator("en").t("Common.noSuchKey")).toBe(
      "Common.noSuchKey",
    );
  });
});
