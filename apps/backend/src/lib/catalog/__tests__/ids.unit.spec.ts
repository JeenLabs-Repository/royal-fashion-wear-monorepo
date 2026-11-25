import { MedusaError } from "@medusajs/framework/utils";
import { buildHandle, formatPlatformSku, randomBase32, slugifyTitle } from "../ids";

describe("handles", () => {
  it("builds a slug, a dash and five base32 characters", () => {
    const handle = buildHandle("Blue Cotton Kurta  (Men's)");
    expect(handle).toMatch(/^[a-z0-9-]+-[a-z2-7]{5}$/);
    expect(handle.startsWith("blue-cotton-kurta-men-s-")).toBe(true);
  });

  it("caps the slug at 60 characters with no trailing dash", () => {
    const slug = slugifyTitle("abcd efgh ".repeat(15));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.startsWith("abcd-efgh")).toBe(true);
  });

  it("falls back to item when no ASCII letter or digit is left", () => {
    expect(slugifyTitle("नमस्ते")).toBe("item");
    expect(buildHandle("नमस्ते").startsWith("item-")).toBe(true);
  });

  it("trims separators and collapses punctuation runs", () => {
    expect(slugifyTitle("  --Hello__World!!  ")).toBe("hello-world");
  });

  it("is random: 1,000 handles for one title give at least 990 distinct values", () => {
    const handles = new Set(Array.from({ length: 1000 }, () => buildHandle("Same Title")));
    expect(handles.size).toBeGreaterThanOrEqual(990);
  });

  it("uses only a-z and 2-7 in the suffix and never draws from Math.random", () => {
    const spy = jest.spyOn(Math, "random");
    try {
      for (let i = 0; i < 1000; i += 1) {
        expect(buildHandle("Title").split("-").pop()).toMatch(/^[a-z2-7]{5}$/);
      }
      expect(randomBase32(40)).toMatch(/^[a-z2-7]{40}$/);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses a random text length outside 1 to 64", () => {
    expect(() => randomBase32(0)).toThrow(MedusaError);
    expect(() => randomBase32(65)).toThrow(MedusaError);
  });
});

describe("platform SKU", () => {
  it("pads to eight digits", () => {
    expect(formatPlatformSku(1)).toBe("PL-00000001");
    expect(formatPlatformSku(12345678)).toBe("PL-12345678");
    expect(formatPlatformSku(99999999)).toBe("PL-99999999");
  });

  it("throws invalid_data on overflow and on a value that is not a positive whole number", () => {
    for (const value of [100_000_000, 0, -1, 1.5, Number.NaN]) {
      let caught: unknown;
      try {
        formatPlatformSku(value);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MedusaError);
      expect((caught as MedusaError).type).toBe(MedusaError.Types.INVALID_DATA);
    }
  });
});
