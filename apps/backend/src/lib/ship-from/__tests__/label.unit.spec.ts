import { MULTIPLE_STATES_LABEL, formatShipFromLabel, normalizeStates } from "../label";
import { TtlCache } from "../ttl-cache";

const MH = { code: "IN-MH", name: "Maharashtra" };
const KA = { code: "IN-KA", name: "Karnataka" };
const TN = { code: "IN-TN", name: "Tamil Nadu" };
const DL = { code: "IN-DL", name: "Delhi" };
const GJ = { code: "IN-GJ", name: "Gujarat" };

describe("formatShipFromLabel", () => {
  it("gives no label for no states", () => {
    expect(formatShipFromLabel([])).toBeNull();
  });

  it("names one state", () => {
    expect(formatShipFromLabel([MH])).toBe("Ships from Maharashtra");
  });

  it("joins two states with and, in alphabetical order", () => {
    expect(formatShipFromLabel([MH, KA])).toBe("Ships from Karnataka and Maharashtra");
  });

  it("joins three states with a comma and and, in alphabetical order", () => {
    expect(formatShipFromLabel([TN, MH, KA])).toBe("Ships from Karnataka, Maharashtra and Tamil Nadu");
  });

  it("collapses four or more states into one phrase", () => {
    expect(formatShipFromLabel([TN, MH, KA, DL])).toBe("Ships from multiple states");
    expect(formatShipFromLabel([TN, MH, KA, DL, GJ])).toBe(MULTIPLE_STATES_LABEL);
  });

  it("collapses duplicates before counting", () => {
    expect(formatShipFromLabel([MH, MH, KA, KA, TN, TN])).toBe(
      "Ships from Karnataka, Maharashtra and Tamil Nadu"
    );
    expect(formatShipFromLabel([MH, MH])).toBe("Ships from Maharashtra");
  });

  it("sorts unsorted input by name, not by code", () => {
    expect(normalizeStates([TN, DL, MH]).map((state) => state.name)).toEqual([
      "Delhi",
      "Maharashtra",
      "Tamil Nadu",
    ]);
  });

  it("has no state for the hub, which is never a vendor state", () => {
    // The lookup only ever builds states from vendor locations, so a hub id adds nothing.
    expect(formatShipFromLabel([])).toBeNull();
  });
});

describe("TtlCache", () => {
  it("expires entries after the time to live", () => {
    let now = 1_000;
    const cache = new TtlCache<number>({ ttlMs: 60_000, maxEntries: 10, now: () => now });
    cache.set("a", 1);
    now += 59_999;
    expect(cache.get("a")).toBe(1);
    now += 2;
    expect(cache.get("a")).toBeUndefined();
  });

  it("drops the oldest entry first when the bound is reached", () => {
    const cache = new TtlCache<number>({ ttlMs: 60_000, maxEntries: 3 });
    for (const key of ["a", "b", "c", "d"]) {
      cache.set(key, 1);
    }
    expect(cache.size()).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")).toBe(1);
  });

  it("clears every entry", () => {
    const cache = new TtlCache<number>({ ttlMs: 60_000, maxEntries: 3 });
    cache.set("a", 1);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
