import {
  STATES,
  getStateByCode,
  getStateByGstCode,
  toMedusaProvince,
  validatePinStatePair,
} from "../states";

describe("STATES", () => {
  test("has 36 entries with unique ISO codes and unique GST codes", () => {
    expect(STATES).toHaveLength(36);
    expect(new Set(STATES.map((state) => state.code)).size).toBe(36);
    expect(new Set(STATES.map((state) => state.gst_code)).size).toBe(36);
  });

  test("exactly five union territories use the UTGST head", () => {
    const utgst = STATES.filter((state) => state.gst_head === "UTGST")
      .map((state) => state.code)
      .sort();
    expect(utgst).toEqual(["IN-AN", "IN-CH", "IN-DH", "IN-LA", "IN-LD"]);
    expect(STATES.filter((state) => state.gst_head === "SGST")).toHaveLength(31);
  });

  test("every entry is well formed and the table is sorted by code", () => {
    for (const state of STATES) {
      expect(state.code).toMatch(/^IN-[A-Z]{2}$/);
      expect(state.name.length).toBeGreaterThan(0);
      expect(state.gst_code).toMatch(/^[0-9]{2}$/);
    }
    const codes = STATES.map((state) => state.code);
    expect(codes).toEqual([...codes].sort());
  });

  test("the retired GST codes 25 and 28 are absent", () => {
    expect(STATES.some((state) => state.gst_code === "25")).toBe(false);
    expect(STATES.some((state) => state.gst_code === "28")).toBe(false);
  });
});

describe("getStateByCode", () => {
  test.each(["IN-MH", "in-mh", "MH", " mh "])("finds Maharashtra for %s", (input) => {
    const state = getStateByCode(input);
    expect(state?.name).toBe("Maharashtra");
    expect(state?.gst_code).toBe("27");
  });

  test("returns undefined for an unknown code", () => {
    expect(getStateByCode("IN-XX")).toBeUndefined();
    expect(getStateByCode("")).toBeUndefined();
  });
});

describe("getStateByGstCode", () => {
  test("finds a state by its GST code, padded or not", () => {
    expect(getStateByGstCode("27")?.code).toBe("IN-MH");
    expect(getStateByGstCode("7")?.code).toBe("IN-DL");
    expect(getStateByGstCode("99")).toBeUndefined();
  });
});

describe("toMedusaProvince", () => {
  test("returns the lowercase ISO form", () => {
    expect(toMedusaProvince("IN-MH")).toBe("in-mh");
    expect(toMedusaProvince("ka")).toBe("in-ka");
  });

  test("throws for an unknown code", () => {
    expect(() => toMedusaProvince("IN-XX")).toThrow("Unknown state code.");
  });
});

describe("validatePinStatePair", () => {
  test("accepts a valid pair", () => {
    expect(validatePinStatePair("400001", "IN-MH")).toEqual({
      ok: true,
      verified: true,
    });
  });

  test.each(["000001", "40001", "4000011", "40000a", "", " 400001"])(
    "rejects the PIN %p with invalid_pin_format",
    (pin) => {
      expect(validatePinStatePair(pin, "IN-MH")).toEqual({
        ok: false,
        reason: "invalid_pin_format",
      });
    }
  );

  test("rejects an unknown state with unknown_state", () => {
    expect(validatePinStatePair("400001", "IN-XX")).toEqual({
      ok: false,
      reason: "unknown_state",
    });
  });

  test("checks the PIN before the state", () => {
    expect(validatePinStatePair("000001", "IN-XX")).toEqual({
      ok: false,
      reason: "invalid_pin_format",
    });
  });
});

describe("validatePinStatePair against the directory", () => {
  it("verifies a known PIN with its own state", () => {
    expect(validatePinStatePair("400001", "IN-MH")).toEqual({
      ok: true,
      verified: true,
    });
    expect(validatePinStatePair("110001", "in-dl")).toEqual({
      ok: true,
      verified: true,
    });
  });

  it("rejects a known PIN with another state and names the expected one", () => {
    expect(validatePinStatePair("400001", "IN-KA")).toEqual({
      ok: false,
      reason: "pin_state_mismatch",
      expected_state: "IN-MH",
    });
  });

  // 999998 is absent from the bundled directory; 999999 is a real Telangana PIN.
  it("accepts an unknown well-formed PIN and marks it unverified", () => {
    expect(validatePinStatePair("999998", "IN-MH")).toEqual({
      ok: true,
      verified: false,
    });
  });

  it("keeps the format and unknown state rules ahead of the directory", () => {
    expect(validatePinStatePair("000001", "IN-MH")).toEqual({
      ok: false,
      reason: "invalid_pin_format",
    });
    expect(validatePinStatePair("400001", "IN-XX")).toEqual({
      ok: false,
      reason: "unknown_state",
    });
  });
});
