import { catalogMiddlewares } from "../middlewares";
import { inventoryMiddlewares } from "../middlewares/inventory";
import { productsMiddlewares } from "../middlewares/products";
import { reviewsMiddlewares } from "../middlewares/reviews";
import { storeMiddlewares } from "../middlewares/store";
import { uploadsMiddlewares } from "../middlewares/uploads";
import { variantHasOpenAssignment } from "../assignment-guard";
import {
  CUSTOMER_IDENTITY_DEFAULTS,
  getCustomerIdentitySettings,
  LM_DISPLAY_MODES,
} from "../../settings/customer-identity";
import { fetchResolvedOptions } from "../../settings/resolve-options";

// The real reader factory runs. Only the call into the settings module is
// replaced, with whatever the fake container currently holds.
jest.mock("../../settings/resolve-options", () => ({ fetchResolvedOptions: jest.fn() }));

type Resolved =
  | { status: "resolved"; options: Record<string, unknown> }
  | { status: "unavailable"; reason: "missing" | "unsaved" | "disabled" };

type FakeContainer = {
  current: Resolved;
  warnings: string[];
  resolve: (key: string) => unknown;
};

const makeContainer = (current: Resolved): FakeContainer => {
  const warnings: string[] = [];
  return {
    current,
    warnings,
    resolve: (key: string) => (key === "logger" ? { warn: (m: string) => warnings.push(m) } : undefined),
  };
};

const resolved = (options: Record<string, unknown>): Resolved => ({ status: "resolved", options });

beforeEach(() => {
  (fetchResolvedOptions as jest.Mock).mockReset();
  (fetchResolvedOptions as jest.Mock).mockImplementation(
    async (container: FakeContainer) => container.current
  );
});

describe("customer identity reader", () => {
  it("allows exactly three modes and defaults to hidden with empty text", () => {
    expect([...LM_DISPLAY_MODES]).toEqual(["hidden", "owner_marketer", "product_declared"]);
    expect(CUSTOMER_IDENTITY_DEFAULTS).toEqual({ lm_display_mode: "hidden", lm_marketer_text: "" });
  });

  it("returns the saved values (resolved case)", async () => {
    const container = makeContainer(
      resolved({ lm_display_mode: "owner_marketer", lm_marketer_text: "Marketed by Example Traders" })
    );
    expect(await getCustomerIdentitySettings(container)).toEqual({
      lm_display_mode: "owner_marketer",
      lm_marketer_text: "Marketed by Example Traders",
    });
  });

  it("gives empty text when only the mode is saved", async () => {
    const container = makeContainer(resolved({ lm_display_mode: "product_declared" }));
    expect(await getCustomerIdentitySettings(container)).toEqual({
      lm_display_mode: "product_declared",
      lm_marketer_text: "",
    });
  });

  it.each(["missing", "unsaved", "disabled"] as const)(
    "gives the defaults and never throws when the card is %s",
    async (reason) => {
      const container = makeContainer({ status: "unavailable", reason });
      await expect(getCustomerIdentitySettings(container)).resolves.toEqual(
        CUSTOMER_IDENTITY_DEFAULTS
      );
    }
  );

  it.each([["shown"], [""], [5], [null]])(
    "falls back to hidden for the invalid mode %p, keeps a valid text and warns once",
    async (badMode) => {
      const container = makeContainer(
        resolved({ lm_display_mode: badMode, lm_marketer_text: "Marketed by Example Traders" })
      );
      expect(await getCustomerIdentitySettings(container)).toEqual({
        lm_display_mode: "hidden",
        lm_marketer_text: "Marketed by Example Traders",
      });
      expect(container.warnings).toHaveLength(1);
    }
  );

  it.each([[42], [null], ["x".repeat(201)]])(
    "falls back to empty text for the invalid text %p, keeps a valid mode and warns",
    async (badText) => {
      const container = makeContainer(
        resolved({ lm_display_mode: "owner_marketer", lm_marketer_text: badText })
      );
      expect(await getCustomerIdentitySettings(container)).toEqual({
        lm_display_mode: "owner_marketer",
        lm_marketer_text: "",
      });
      expect(container.warnings).toHaveLength(1);
    }
  );

  it("trims a valid text and accepts exactly 200 characters", async () => {
    const container = makeContainer(
      resolved({ lm_display_mode: "owner_marketer", lm_marketer_text: `  ${"y".repeat(200)}  ` })
    );
    const settings = await getCustomerIdentitySettings(container);
    expect(settings.lm_marketer_text).toBe("y".repeat(200));
    expect(container.warnings).toHaveLength(0);
  });

  it("ignores other options on the card", async () => {
    const container = makeContainer(
      resolved({ lm_display_mode: "hidden", lm_marketer_text: "", return_window_days: 7 })
    );
    expect(Object.keys(await getCustomerIdentitySettings(container)).sort()).toEqual([
      "lm_display_mode",
      "lm_marketer_text",
    ]);
  });

  it("reads at call time: containers differ and a changed value shows on the next call", async () => {
    const first = makeContainer(resolved({ lm_display_mode: "owner_marketer", lm_marketer_text: "One" }));
    const second = makeContainer(resolved({ lm_display_mode: "product_declared" }));
    expect((await getCustomerIdentitySettings(first)).lm_marketer_text).toBe("One");
    expect((await getCustomerIdentitySettings(second)).lm_display_mode).toBe("product_declared");

    first.current = resolved({ lm_display_mode: "owner_marketer", lm_marketer_text: "Two" });
    expect((await getCustomerIdentitySettings(first)).lm_marketer_text).toBe("Two");
  });

  it("100 parallel calls on a missing card all resolve to hidden", async () => {
    const container = makeContainer({ status: "unavailable", reason: "missing" });
    const results = await Promise.all(
      Array.from({ length: 100 }, () => getCustomerIdentitySettings(container))
    );
    expect(results).toHaveLength(100);
    for (const result of results) {
      expect(result).toEqual({ lm_display_mode: "hidden", lm_marketer_text: "" });
    }
  });
});

describe("assignment guard and middleware slots", () => {
  it("variantHasOpenAssignment resolves to false", async () => {
    await expect(variantHasOpenAssignment("variant_x")).resolves.toBe(false);
  });

  it("catalogMiddlewares equals the concatenation of the five slot arrays in order", () => {
    const slots = [
      uploadsMiddlewares,
      productsMiddlewares,
      inventoryMiddlewares,
      reviewsMiddlewares,
      storeMiddlewares,
    ];
    for (const slot of slots) {
      expect(Array.isArray(slot)).toBe(true);
    }
    expect(catalogMiddlewares).toEqual(slots.flat());
  });
});
