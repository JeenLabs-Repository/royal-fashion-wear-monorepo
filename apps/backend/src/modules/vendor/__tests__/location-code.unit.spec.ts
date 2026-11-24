import { formatLocationCode } from "../utils/location-code";

describe("formatLocationCode", () => {
  test.each([
    [1, "LOC-0001"],
    [42, "LOC-0042"],
    [9999, "LOC-9999"],
    [10000, "LOC-10000"],
  ])("formats %i as %s", (input, expected) => {
    expect(formatLocationCode(input)).toBe(expected);
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws for %p",
    (input) => {
      expect(() => formatLocationCode(input)).toThrow();
    }
  );
});
