import {
  MAX_FIELD_PARAM_LENGTH,
  TOO_LONG_MARKER,
  collectFieldTerms,
  findForbiddenTerm,
  isForbiddenSegment,
} from "../forbidden-fields";

describe("findForbiddenTerm", () => {
  test.each([
    ["vendor_id", "vendor_id"],
    ["*vendor", "*vendor"],
    ["+stock_location.name", "+stock_location.name"],
    ["variants.inventory_items.location_levels", "variants.inventory_items.location_levels"],
    ["metadata.vendor_note", "metadata.vendor_note"],
    ["id,title,*variants.inventory", "*variants.inventory"],
    ["+ vendor", "+ vendor"],
    ["*Vendor", "*Vendor"],
    ["variants. vendor", "variants. vendor"],
    ["-reservations", "-reservations"],
    ["*assignment.items", "*assignment.items"],
    ["routing", "routing"],
    ["courier_name", "courier_name"],
    ["awb", "awb"],
    ["submission", "submission"],
    ["location", "location"],
    ["locations", "locations"],
    ["location_levels", "location_levels"],
    ["inventory_items", "inventory_items"],
  ])("rejects %s", (input, expected) => {
    expect(findForbiddenTerm(input)).toBe(expected);
  });

  test.each([
    "+metadata",
    "+items.metadata",
    "+options.values.metadata",
    "+variants.inventory_quantity",
    "*variants.calculated_price",
    "*",
    "id,title",
    "",
    "allocation",
    "relocation",
    "variants.manage_inventory",
    "variants.allow_backorder",
    "*items, *region, *items.product, *items.variant, +shipping_methods.data",
  ])("allows %p", (input) => {
    expect(findForbiddenTerm(input)).toBeNull();
  });

  test("returns the marker for a value longer than the limit", () => {
    expect(findForbiddenTerm("a".repeat(MAX_FIELD_PARAM_LENGTH + 1))).toBe(TOO_LONG_MARKER);
    expect(findForbiddenTerm("a".repeat(MAX_FIELD_PARAM_LENGTH))).toBeNull();
  });
});

describe("isForbiddenSegment", () => {
  test("treats the inventory quantity segment as the only exception", () => {
    expect(isForbiddenSegment("inventory_quantity")).toBe(false);
    expect(isForbiddenSegment("inventory_quantity_total")).toBe(true);
  });

  test("is case insensitive and tolerates surrounding spaces", () => {
    expect(isForbiddenSegment(" VENDOR ")).toBe(true);
  });
});

describe("collectFieldTerms", () => {
  test("collects fields, expand, include and the bracket form in URL order", () => {
    const params = new URLSearchParams("fields=a,b&expand=c&include=d&fields[]=e&limit=5");
    expect(collectFieldTerms(params)).toEqual(["a,b", "c", "d", "e"]);
  });

  test("collects an indexed bracket form and ignores other keys", () => {
    const params = new URLSearchParams("fields[0]=x&q=fields&offset=0");
    expect(collectFieldTerms(params)).toEqual(["x"]);
  });

  test("returns an empty list when none are present", () => {
    expect(collectFieldTerms(new URLSearchParams("limit=1"))).toEqual([]);
  });
});
