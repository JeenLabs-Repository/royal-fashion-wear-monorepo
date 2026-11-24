import { computeStateCoverage } from "../state-coverage";

const vendors = [
  { id: "A", status: "active" },
  { id: "B", status: "active" },
  { id: "C", status: "suspended" },
  { id: "D", status: "active" },
  { id: "E", status: "invited" },
];

const locations = [
  { vendor_id: "A", state_code: "IN-MH", status: "active" },
  { vendor_id: "A", state_code: "IN-KA", status: "active" },
  { vendor_id: "B", state_code: "IN-MH", status: "active" },
  { vendor_id: "C", state_code: "IN-KA", status: "active" },
  { vendor_id: "D", state_code: "IN-DL", status: "inactive" },
  { vendor_id: "E", state_code: "IN-TN", status: "active" },
];

describe("computeStateCoverage", () => {
  test("returns only served states, sorted by state name, with the single vendor flag", () => {
    expect(computeStateCoverage(vendors, locations)).toEqual([
      { state_code: "IN-KA", state_name: "Karnataka", active_vendor_count: 1, single_vendor: true },
      {
        state_code: "IN-MH",
        state_name: "Maharashtra",
        active_vendor_count: 2,
        single_vendor: false,
      },
    ]);
  });

  test("ignores suspended vendors, inactive locations and vendors that are not active", () => {
    const states = computeStateCoverage(vendors, locations).map((entry) => entry.state_code);
    expect(states).not.toContain("IN-DL");
    expect(states).not.toContain("IN-TN");
  });

  test("counts a vendor once per state even with several locations there", () => {
    const result = computeStateCoverage(
      [{ id: "A", status: "active" }],
      [
        { vendor_id: "A", state_code: "IN-MH", status: "active" },
        { vendor_id: "A", state_code: "IN-MH", status: "active" },
      ]
    );
    expect(result).toEqual([
      {
        state_code: "IN-MH",
        state_name: "Maharashtra",
        active_vendor_count: 1,
        single_vendor: true,
      },
    ]);
  });

  test("accepts a state code in any supported form and skips unknown states", () => {
    const result = computeStateCoverage(
      [{ id: "A", status: "active" }],
      [
        { vendor_id: "A", state_code: "in-mh", status: "active" },
        { vendor_id: "A", state_code: "IN-XX", status: "active" },
      ]
    );
    expect(result.map((entry) => entry.state_code)).toEqual(["IN-MH"]);
  });

  test("ignores a location whose vendor is not in the list", () => {
    expect(
      computeStateCoverage([], [{ vendor_id: "Z", state_code: "IN-MH", status: "active" }])
    ).toEqual([]);
  });

  test("returns an empty list for no data", () => {
    expect(computeStateCoverage([], [])).toEqual([]);
  });

  test("stops flagging a state once a second active vendor serves it", () => {
    const result = computeStateCoverage(
      [
        { id: "A", status: "active" },
        { id: "B", status: "active" },
      ],
      [
        { vendor_id: "A", state_code: "IN-KA", status: "active" },
        { vendor_id: "B", state_code: "IN-KA", status: "active" },
      ]
    );
    expect(result[0]).toMatchObject({ active_vendor_count: 2, single_vendor: false });
  });
});
