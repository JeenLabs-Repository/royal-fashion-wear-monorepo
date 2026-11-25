import { LM_DISPLAY_FIELDS, buildDeclarationLines, countryName } from "../declarations";

const settings = { lm_marketer_text: "Canary Marketer Text Ltd" };
const full = {
  generic_name: "Cotton shirt",
  country_of_origin: "IN",
  packed_by_name: "Canary Packer",
  packed_by_address: "1 Canary Road, Mumbai",
};

describe("buildDeclarationLines", () => {
  it("returns nothing in hidden mode whatever the inputs", () => {
    expect(buildDeclarationLines("hidden", settings, full)).toEqual([]);
    expect(buildDeclarationLines("hidden", { lm_marketer_text: "" }, null)).toEqual([]);
  });

  it("returns one Marketed by line in owner_marketer mode and ignores the declaration", () => {
    const lines = buildDeclarationLines("owner_marketer", settings, full);
    expect(lines).toEqual([{ label: "Marketed by", value: "Canary Marketer Text Ltd" }]);
    expect(JSON.stringify(lines)).not.toContain("Canary Packer");
  });

  it("returns no line when the owner text is empty", () => {
    expect(buildDeclarationLines("owner_marketer", { lm_marketer_text: "   " }, full)).toEqual([]);
  });

  it("returns the non-empty declared fields in order with the English country name", () => {
    expect(buildDeclarationLines("product_declared", settings, full)).toEqual([
      { label: "Generic name", value: "Cotton shirt" },
      { label: "Country of origin", value: "India" },
      { label: "Packed by", value: "Canary Packer" },
      { label: "Address", value: "1 Canary Road, Mumbai" },
    ]);
  });

  it("returns one line for a declaration with only a country", () => {
    expect(
      buildDeclarationLines("product_declared", settings, { country_of_origin: "IN" })
    ).toEqual([{ label: "Country of origin", value: "India" }]);
  });

  it("returns nothing when there is no declaration row", () => {
    expect(buildDeclarationLines("product_declared", settings, null)).toEqual([]);
  });

  it("never lets angle brackets through", () => {
    const lines = buildDeclarationLines("product_declared", settings, {
      generic_name: "<script>x</script>Shirt",
      packed_by_address: "A > B < C",
    });
    for (const line of lines) {
      expect(line.value).not.toMatch(/[<>]/);
    }
  });

  it("answers nothing for an unknown mode", () => {
    expect(buildDeclarationLines("shown" as never, settings, full)).toEqual([]);
  });

  it("lists exactly the four declared labels and no price or quantity field", () => {
    const labels = LM_DISPLAY_FIELDS.product_declared.map((spec) => spec.label);
    expect(labels).toEqual(["Generic name", "Country of origin", "Packed by", "Address"]);
  });
});

describe("countryName", () => {
  it("gives English names and falls back to the code", () => {
    expect(countryName("IN")).toBe("India");
    expect(countryName("in")).toBe("India");
    expect(countryName("ZZZ9")).toBe("ZZZ9");
  });
});
