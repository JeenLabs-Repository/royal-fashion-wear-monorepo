import { normalizePhone, validateAddressInput } from "../address-validation";

const base = {
  first_name: "Asha",
  address_1: "12 Main Road",
  city: "Mumbai",
  country_code: "in",
};

describe("normalizePhone", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["+91 98765 43210", "9876543210"],
    ["+919876543210", "9876543210"],
    ["919876543210", "9876543210"],
    ["09876543210", "9876543210"],
    ["98765-43210", "9876543210"],
    ["(98765) 43210", "9876543210"],
    ["6000000000", "6000000000"],
  ])("reduces %s to %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    "5876543210",
    "98765",
    "abcdefghij",
    "+1 9876543210",
    "98765432100",
    "",
    "+91",
  ])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("validateAddressInput province and PIN", () => {
  it("accepts a verified pair and normalises the province", () => {
    const result = validateAddressInput({
      ...base,
      postal_code: "400001",
      province: "IN-MH",
      phone: "9876543210",
    });
    expect(result).toEqual({
      ok: true,
      address: {
        ...base,
        postal_code: "400001",
        province: "in-mh",
        phone: "9876543210",
      },
    });
  });

  it.each(["in-mh", "IN-MH", "in-MH"])("normalises %s to in-mh", (province) => {
    const result = validateAddressInput({
      ...base,
      postal_code: "400001",
      province,
    });
    expect(result.ok && result.address.province).toBe("in-mh");
  });

  it.each(["Maharashtra", "MH", "", "in-zz", "xx-mh"])(
    "rejects province %p with a postal code",
    (province) => {
      const result = validateAddressInput({
        ...base,
        postal_code: "400001",
        province,
      });
      expect(result).toMatchObject({ ok: false, code: "invalid_province" });
    }
  );

  it("rejects a missing province when a postal code is present", () => {
    expect(
      validateAddressInput({ ...base, postal_code: "400001" })
    ).toMatchObject({ ok: false, code: "invalid_province" });
  });

  it("rejects a known PIN with another state", () => {
    expect(
      validateAddressInput({ ...base, postal_code: "400001", province: "in-ka" })
    ).toMatchObject({ ok: false, code: "pin_state_mismatch" });
  });

  it.each(["40001", "4000011", "000001", "40000a", "012345"])(
    "rejects the malformed PIN %s",
    (postal_code) => {
      expect(
        validateAddressInput({ ...base, postal_code, province: "in-mh" })
      ).toMatchObject({ ok: false, code: "invalid_pin_format" });
    }
  );

  it("treats a blank postal code as absent", () => {
    const input = { ...base, postal_code: "", province: "", phone: "" };
    expect(validateAddressInput(input)).toEqual({ ok: true, address: input });
  });

  it("trims whitespace around the PIN", () => {
    const result = validateAddressInput({
      ...base,
      postal_code: " 400001 ",
      province: "in-mh",
    });
    expect(result.ok && result.address.postal_code).toBe("400001");
  });
});

describe("validateAddressInput unverified flag", () => {
  // 999998 is absent from the bundled directory; 999999 is a real Telangana PIN.
  it("accepts an unknown PIN and flags it", () => {
    const result = validateAddressInput({
      ...base,
      postal_code: "999998",
      province: "in-mh",
    });
    expect(result).toMatchObject({
      ok: true,
      address: { metadata: { pin_unverified: true } },
    });
  });

  it("keeps other metadata keys when flagging", () => {
    const result = validateAddressInput({
      ...base,
      postal_code: "999998",
      province: "in-mh",
      metadata: { note: "gate code at desk" },
    });
    expect(result.ok && result.address.metadata).toEqual({
      note: "gate code at desk",
      pin_unverified: true,
    });
  });

  it("removes a stale flag when the PIN is now verified", () => {
    const result = validateAddressInput({
      ...base,
      postal_code: "400001",
      province: "in-mh",
      metadata: { pin_unverified: true, note: "keep" },
    });
    expect(result.ok && result.address.metadata).toEqual({ note: "keep" });
  });

  it("adds no metadata key to a verified address that had none", () => {
    const result = validateAddressInput({
      ...base,
      postal_code: "400001",
      province: "in-mh",
    });
    expect(result.ok && "metadata" in result.address).toBe(false);
  });
});

describe("validateAddressInput phone", () => {
  it("stores the ten-digit form", () => {
    const result = validateAddressInput({ ...base, phone: "+91 98765 43210" });
    expect(result.ok && result.address.phone).toBe("9876543210");
  });

  it.each(["1234567890", "98765", "+1 9876543210"])(
    "rejects the phone %s",
    (phone) => {
      expect(validateAddressInput({ ...base, phone })).toMatchObject({
        ok: false,
        code: "invalid_phone",
      });
    }
  );

  it("rejects a numeric phone value", () => {
    expect(
      validateAddressInput({ ...base, phone: 9876543210 as unknown as string })
    ).toMatchObject({ ok: false, code: "invalid_phone" });
  });

  it("allows an absent phone", () => {
    expect(validateAddressInput({ ...base })).toEqual({
      ok: true,
      address: { ...base },
    });
  });
});

describe("validateAddressInput scope and purity", () => {
  it("passes an object with no postal code and no phone unchanged", () => {
    const input = { first_name: "Asha", address_1: "12 Main Road" };
    expect(validateAddressInput(input)).toEqual({ ok: true, address: input });
  });

  it("skips every rule for another country", () => {
    const input = {
      country_code: "us",
      postal_code: "12345",
      province: "NY",
      phone: "+1 212 555 0100",
    };
    expect(validateAddressInput(input)).toEqual({ ok: true, address: input });
  });

  it("never mutates the input or its metadata", () => {
    const metadata = { pin_unverified: true };
    const input = {
      ...base,
      postal_code: "400001",
      province: "IN-MH",
      phone: "+919876543210",
      metadata,
    };
    const copy = JSON.parse(JSON.stringify(input));
    validateAddressInput(input);
    expect(input).toEqual(copy);
    expect(metadata).toEqual({ pin_unverified: true });
  });

  it("uses short messages that name no dataset", () => {
    const result = validateAddressInput({
      ...base,
      postal_code: "400001",
      province: "in-ka",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/directory|dataset|json|file/i);
    }
  });
});
