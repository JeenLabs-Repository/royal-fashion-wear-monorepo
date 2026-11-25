import { diffSnapshots, type DiffableSnapshot } from "../diff";

const base = (): DiffableSnapshot => ({
  title: "Cotton Kurta",
  description: "Soft cotton kurta",
  images: [{ upload_id: "up_1" }, { upload_id: "up_2" }],
  options: [{ title: "Size", values: ["S", "M"] }],
  variants: [
    {
      vendor_sku: "K-S",
      option_values: { Size: "S" },
      payout_price: "199.00",
      mrp: "499.00",
      net_quantity_value: 1,
      net_quantity_unit: "pcs",
      weight_g: 200,
    },
    {
      vendor_sku: "K-M",
      option_values: { Size: "M" },
      payout_price: "209.00",
      mrp: "519.00",
      net_quantity_value: 1,
      net_quantity_unit: "pcs",
      weight_g: 210,
    },
  ],
  proposed_category_id: "pcat_1",
  proposed_gst_class: "GST-5",
  proposed_hsn: "6109",
  declaration: {
    generic_name: "Kurta",
    country_of_origin: "IN",
    packed_by_name: "Example Packer",
    packed_by_address: "1 Example Road",
  },
});

const paths = (live: DiffableSnapshot, pending: DiffableSnapshot) =>
  diffSnapshots(live, pending).map((entry) => entry.path);

describe("diffSnapshots", () => {
  it("returns an empty list for equal snapshots", () => {
    expect(diffSnapshots(base(), base())).toEqual([]);
  });

  it("returns one entry per changed scalar with before and after", () => {
    const pending = base();
    pending.title = "Cotton Kurta Long";
    pending.description = "Longer cotton kurta";
    pending.proposed_category_id = "pcat_2";
    pending.proposed_gst_class = "GST-18";
    pending.proposed_hsn = "610910";

    const entries = diffSnapshots(base(), pending);
    expect(entries.map((entry) => entry.path)).toEqual([
      "title",
      "description",
      "proposed_category_id",
      "proposed_gst_class",
      "proposed_hsn",
    ]);
    expect(entries[0]).toEqual({ path: "title", before: "Cotton Kurta", after: "Cotton Kurta Long" });
  });

  it("returns one entry per changed declaration field", () => {
    const pending = base();
    pending.declaration = {
      generic_name: "Tunic",
      country_of_origin: "BD",
      packed_by_name: "Example Packer",
      packed_by_address: "2 Example Road",
    };
    expect(paths(base(), pending)).toEqual([
      "declaration.generic_name",
      "declaration.country_of_origin",
      "declaration.packed_by_address",
    ]);
  });

  it("treats a reorder of the images as one change with both lists", () => {
    const pending = base();
    pending.images = [{ upload_id: "up_2" }, { upload_id: "up_1" }];
    expect(diffSnapshots(base(), pending)).toEqual([
      { path: "images", before: ["up_1", "up_2"], after: ["up_2", "up_1"] },
    ]);
  });

  it("reports an added image", () => {
    const pending = base();
    pending.images = [...pending.images, { upload_id: "up_3" }];
    expect(diffSnapshots(base(), pending)).toEqual([
      { path: "images", before: ["up_1", "up_2"], after: ["up_1", "up_2", "up_3"] },
    ]);
  });

  it("reports an option list change as one entry", () => {
    const pending = base();
    pending.options = [{ title: "Size", values: ["S", "M", "L"] }];
    expect(diffSnapshots(base(), pending)).toEqual([
      { path: "options", before: ["Size: S, M"], after: ["Size: S, M, L"] },
    ]);
  });

  it("reports an added variant by vendor SKU", () => {
    const pending = base();
    pending.variants.push({ vendor_sku: "K-L", option_values: { Size: "L" }, payout_price: "219.00" });
    expect(diffSnapshots(base(), pending)).toEqual([
      { path: "variants[K-L]", before: "absent", after: "added" },
    ]);
  });

  it("reports a removed variant by vendor SKU", () => {
    const pending = base();
    pending.variants = pending.variants.filter((variant) => variant.vendor_sku !== "K-M");
    expect(diffSnapshots(base(), pending)).toEqual([
      { path: "variants[K-M]", before: "present", after: "removed" },
    ]);
  });

  it("reports each changed variant property under the SKU in a fixed order", () => {
    const pending = base();
    pending.variants[0].mrp = "549.00";
    pending.variants[0].payout_price = "189.00";
    pending.variants[0].net_quantity_unit = "g";
    pending.variants[0].weight_g = 250;
    expect(paths(base(), pending)).toEqual([
      "variants[K-S].payout_price",
      "variants[K-S].mrp",
      "variants[K-S].net_quantity_unit",
      "variants[K-S].weight_g",
    ]);
  });

  it("reports a changed option value of a variant", () => {
    const pending = base();
    pending.variants[0].option_values = { Size: "XS" };
    expect(diffSnapshots(base(), pending)).toEqual([
      { path: "variants[K-S].option_values.Size", before: "S", after: "XS" },
    ]);
  });

  it("matches variants by SKU, not by position, and keeps the order stable", () => {
    const pending = base();
    pending.variants.reverse();
    pending.variants.find((variant) => variant.vendor_sku === "K-M")!.payout_price = "210.00";
    const first = diffSnapshots(base(), pending);
    expect(first).toEqual([{ path: "variants[K-M].payout_price", before: "209.00", after: "210.00" }]);

    const second = base();
    second.variants.reverse();
    second.variants.find((variant) => variant.vendor_sku === "K-M")!.payout_price = "210.00";
    expect(diffSnapshots(base(), second)).toEqual(first);
  });

  it("treats a missing value and null as equal", () => {
    const live = base();
    const pending = base();
    delete live.variants[0].mrp;
    pending.variants[0].mrp = null;
    delete live.proposed_hsn;
    pending.proposed_hsn = null;
    expect(diffSnapshots(live, pending)).toEqual([]);
  });

  it("orders entries title, description, images, then declaration, then variants", () => {
    const pending = base();
    pending.variants[1].payout_price = "300.00";
    pending.declaration = { ...pending.declaration, generic_name: "Tunic" };
    pending.images = [{ upload_id: "up_2" }, { upload_id: "up_1" }];
    pending.description = "Changed";
    pending.title = "Changed";
    expect(paths(base(), pending)).toEqual([
      "title",
      "description",
      "images",
      "declaration.generic_name",
      "variants[K-M].payout_price",
    ]);
  });
});
