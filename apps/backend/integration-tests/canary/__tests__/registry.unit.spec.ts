import { missingCategories, REQUIRED_KINDS } from "../surfaces/categories";
import {
  type Surface,
  assertAllExercised,
  clearRegistry,
  exercisedReport,
  listSurfaces,
  markExercised,
  registerSurface,
} from "../surfaces/registry";

const surface = (overrides: Partial<Surface> = {}): Surface => ({
  id: "demo-surface",
  kind: "store-api",
  owner: "tests",
  description: "A surface used by the registry tests",
  minRequests: 2,
  collect: async () => [],
  ...overrides,
});

beforeEach(() => clearRegistry());

describe("registerSurface", () => {
  it("accepts a valid surface", () => {
    registerSurface(surface());
    expect(listSurfaces().map((entry) => entry.id)).toEqual(["demo-surface"]);
  });

  it("rejects a duplicate id", () => {
    registerSurface(surface());
    expect(() => registerSurface(surface())).toThrow(/already registered/);
  });

  it("rejects an empty id", () => {
    expect(() => registerSurface(surface({ id: "  " }))).toThrow(/non-empty id/);
  });

  it.each([0, -1, 1.5])("rejects minRequests of %s", (minRequests) => {
    expect(() => registerSurface(surface({ minRequests }))).toThrow(/minRequests/);
  });
});

describe("assertAllExercised", () => {
  it("throws naming a surface that was never exercised", () => {
    registerSurface(surface({ id: "never-run" }));
    expect(() => assertAllExercised()).toThrow(/never-run/);
  });

  it("throws naming every surface below its minimum", () => {
    registerSurface(surface({ id: "a", minRequests: 3 }));
    registerSurface(surface({ id: "b", minRequests: 1 }));
    markExercised("a", 2);
    let message = "";
    try {
      assertAllExercised();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("- a: 2 request(s), at least 3 required");
    expect(message).toContain("- b: 0 request(s), at least 1 required");
  });

  it("passes when every surface met its minimum", () => {
    registerSurface(surface({ id: "a", minRequests: 2 }));
    markExercised("a", 1);
    markExercised("a", 1);
    expect(() => assertAllExercised()).not.toThrow();
    expect(exercisedReport()[0].satisfied).toBe(true);
  });

  it("is reset by clearRegistry", () => {
    registerSurface(surface());
    markExercised("demo-surface", 5);
    clearRegistry();
    expect(listSurfaces()).toEqual([]);
    expect(() => assertAllExercised()).not.toThrow();
  });
});

describe("missingCategories", () => {
  it("requires exactly the ten customer-facing kinds", () => {
    expect([...REQUIRED_KINDS].sort()).toEqual(
      [
        "email",
        "image",
        "llms-txt",
        "pdf",
        "sitemap",
        "storefront-html",
        "storefront-json-ld",
        "storefront-rsc",
        "store-api",
        "tracking",
      ].sort()
    );
    expect(REQUIRED_KINDS).toHaveLength(10);
    expect(REQUIRED_KINDS).not.toContain("plugin-placeholder");
  });

  it("reports the kinds nobody covers yet", () => {
    const registered = [
      "store-api",
      "storefront-html",
      "storefront-rsc",
      "storefront-json-ld",
      "sitemap",
      "llms-txt",
      "plugin-placeholder",
    ] as const;
    expect([...missingCategories([...registered])].sort()).toEqual(["email", "image", "pdf", "tracking"]);
  });

  it("reports nothing when every required kind is present", () => {
    expect(missingCategories([...REQUIRED_KINDS])).toEqual([]);
  });
});
