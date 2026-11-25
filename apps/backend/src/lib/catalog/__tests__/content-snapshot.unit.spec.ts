import {
  canonicalJson,
  contentHash,
  vendorContentSchema,
  type ContentSnapshot,
} from "../content-snapshot";
import { toValidationIssues, validateCatalogBody } from "../validate-body";

type Body = Record<string, any>;

const validBody = (): Body => ({
  title: "Blue Cotton Kurta",
  description: "Soft cotton kurta.\nMachine washable.",
  images: [{ upload_id: "vupl_01" }, { upload_id: "vupl_02" }],
  options: [{ title: "Size", values: ["S", "M"] }],
  variants: [
    {
      vendor_sku: "KURTA-S",
      option_values: { Size: "S" },
      payout_price: "199.99",
      mrp: "499.00",
      net_quantity_value: 1,
      net_quantity_unit: "pcs",
      weight_g: 250,
      length_mm: 700,
      width_mm: 500,
      height_mm: 20,
    },
    { vendor_sku: "KURTA-M", option_values: { Size: "M" }, payout_price: "209.99" },
  ],
  proposed_category_id: "pcat_01",
  proposed_gst_class: "GST-5",
  proposed_hsn: "6104",
  declaration: {
    generic_name: "Kurta",
    country_of_origin: "IN",
    packed_by_name: "Example Traders",
    packed_by_address: "12 Example Road, Mumbai 400001",
  },
});

const issuePaths = (input: unknown): string[] => {
  const result = vendorContentSchema.safeParse(input);
  return result.success ? [] : toValidationIssues(result.error).map((issue) => issue.path);
};

const parse = (input: unknown): ContentSnapshot => vendorContentSchema.parse(input);

describe("vendorContentSchema accepts", () => {
  it("a complete valid body", () => {
    expect(vendorContentSchema.safeParse(validBody()).success).toBe(true);
  });

  it("an mrp below the payout price (the approver reviews it) and a missing HSN", () => {
    const body = validBody();
    body.variants[0].mrp = "100.00";
    delete body.proposed_hsn;
    expect(vendorContentSchema.safeParse(body).success).toBe(true);
  });

  it("a description with tags and returns it stripped", () => {
    const body = validBody();
    body.description = "<b>Soft</b> cotton<script>alert(1)</script>";
    expect(parse(body).description).toBe("Soft cotton");
  });

  it("amounts come back with two decimals", () => {
    const body = validBody();
    body.variants[1].payout_price = "209.9";
    expect(parse(body).variants[1].payout_price).toBe("209.90");
  });
});

describe("vendorContentSchema rejects, with the right path", () => {
  const long = (n: number) => "a".repeat(n);
  const cases: [string, (body: Body) => void, string][] = [
    ["unknown key status", (b) => (b.status = "published"), "status"],
    ["metadata", (b) => (b.metadata = { a: 1 }), "metadata"],
    ["handle", (b) => (b.handle = "x"), "handle"],
    ["price", (b) => (b.price = "10.00"), "price"],
    ["sales_channels", (b) => (b.sales_channels = ["sc_1"]), "sales_channels"],
    ["tags", (b) => (b.tags = ["a"]), "tags"],
    ["title over 150", (b) => (b.title = long(151)), "title"],
    ["description over 5,000 after stripping", (b) => (b.description = long(5001)), "description"],
    [
      "11 images",
      (b) => (b.images = Array.from({ length: 11 }, (_, i) => ({ upload_id: `u${i}` }))),
      "images",
    ],
    ["0 images", (b) => (b.images = []), "images"],
    ["an image URL key", (b) => (b.images[0] = { upload_id: "u1", url: "https://x.test/a.jpg" }), "images.0.url"],
    ["a repeated image", (b) => (b.images[1].upload_id = "vupl_01"), "images.1.upload_id"],
    [
      "4 options",
      (b) => (b.options = ["A", "B", "C", "D"].map((title) => ({ title, values: ["x"] }))),
      "options",
    ],
    [
      "51 variants",
      (b) =>
        (b.variants = Array.from({ length: 51 }, (_, i) => ({
          vendor_sku: `SKU-${i}`,
          option_values: { Size: "S" },
          payout_price: "10.00",
        }))),
      "variants",
    ],
    ["duplicate vendor_sku", (b) => (b.variants[1].vendor_sku = "KURTA-S"), "variants.1.vendor_sku"],
    ["vendor_sku with a space", (b) => (b.variants[0].vendor_sku = "KURTA S"), "variants.0.vendor_sku"],
    ["variant missing an option value", (b) => (b.variants[1].option_values = {}), "variants.1.option_values.Size"],
    ["option value not in the list", (b) => (b.variants[1].option_values = { Size: "XL" }), "variants.1.option_values.Size"],
    ["same option combination", (b) => (b.variants[1].option_values = { Size: "S" }), "variants.1.option_values"],
    ["payout_price 0", (b) => (b.variants[0].payout_price = "0"), "variants.0.payout_price"],
    ["payout_price 1e3", (b) => (b.variants[0].payout_price = "1e3"), "variants.0.payout_price"],
    ["payout_price as a number", (b) => (b.variants[0].payout_price = 199), "variants.0.payout_price"],
    ["net_quantity_unit oz", (b) => (b.variants[0].net_quantity_unit = "oz"), "variants.0.net_quantity_unit"],
    ["weight_g negative", (b) => (b.variants[0].weight_g = -5), "variants.0.weight_g"],
    ["unknown variant key sku", (b) => (b.variants[0].sku = "PL-1"), "variants.0.sku"],
    ["country_of_origin lower case", (b) => (b.declaration.country_of_origin = "in"), "declaration.country_of_origin"],
    ["country_of_origin three letters", (b) => (b.declaration.country_of_origin = "IND"), "declaration.country_of_origin"],
    ["unknown declaration key", (b) => (b.declaration.brand = "x"), "declaration.brand"],
    ["proposed_hsn of five digits", (b) => (b.proposed_hsn = "12345"), "proposed_hsn"],
    ["proposed_gst_class unknown", (b) => (b.proposed_gst_class = "GST-12"), "proposed_gst_class"],
    ["several variants with no option", (b) => (b.options = []), "variants"],
  ];

  it.each(cases)("%s", (_name, mutate, path) => {
    const body = validBody();
    mutate(body);
    expect(issuePaths(body)).toContain(path);
  });
});

describe("contentHash", () => {
  // Reverses key order everywhere and the order of the variants list only.
  const shuffle = (value: unknown, key?: string): unknown => {
    if (Array.isArray(value)) {
      const items = value.map((item) => shuffle(item));
      return key === "variants" ? items.reverse() : items;
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([name, inner]) => [name, shuffle(inner, name)])
      );
    }
    return value;
  };

  it("is the same when only key order and variant order differ", () => {
    const original = parse(validBody());
    const shuffled = shuffle(original) as ContentSnapshot;
    expect(shuffled.variants[0].vendor_sku).toBe("KURTA-M");
    expect(contentHash(shuffled)).toBe(contentHash(original));
    expect(canonicalJson(shuffled)).toBe(canonicalJson(original));
  });

  it("is a 64-character hex digest", () => {
    expect(contentHash(parse(validBody()))).toMatch(/^[0-9a-f]{64}$/);
  });

  const changes: [string, (body: Body) => void][] = [
    ["title", (b) => (b.title = "Red Cotton Kurta")],
    ["description", (b) => (b.description = "Different text")],
    ["image order", (b) => b.images.reverse()],
    ["a payout price", (b) => (b.variants[0].payout_price = "200.00")],
    ["mrp", (b) => (b.variants[0].mrp = "599.00")],
    ["a variant SKU", (b) => (b.variants[1].vendor_sku = "KURTA-L")],
    ["declaration country", (b) => (b.declaration.country_of_origin = "BD")],
    ["proposed GST class", (b) => (b.proposed_gst_class = "GST-18")],
    ["proposed HSN", (b) => (b.proposed_hsn = "610410")],
  ];

  it.each(changes)("changes when %s changes", (_name, mutate) => {
    const body = validBody();
    mutate(body);
    expect(contentHash(parse(body))).not.toBe(contentHash(parse(validBody())));
  });
});

describe("validateCatalogBody", () => {
  const fakeResponse = () => {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  it("answers 400 with one issue per failure and does not call next", () => {
    const res = fakeResponse();
    const next = jest.fn();
    const body = validBody();
    body.status = "published";
    body.variants[1].vendor_sku = "KURTA-S";
    validateCatalogBody(vendorContentSchema)({ body } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ type: "invalid_data", code: "validation_failed" });
    expect(payload.issues.map((issue: { path: string }) => issue.path).sort()).toEqual([
      "status",
      "variants.1.vendor_sku",
    ]);
    expect(next).not.toHaveBeenCalled();
  });

  it("sets validatedBody to the parsed, normalised value and calls next", () => {
    const res = fakeResponse();
    const next = jest.fn();
    const body = validBody();
    body.variants[1].payout_price = "209.9";
    const req: Body = { body };
    validateCatalogBody(vendorContentSchema)(req as any, res as any, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(req.validatedBody.variants[1].payout_price).toBe("209.90");
  });

  it("treats a missing body as a validation failure", () => {
    const res = fakeResponse();
    const next = jest.fn();
    validateCatalogBody(vendorContentSchema)({} as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
