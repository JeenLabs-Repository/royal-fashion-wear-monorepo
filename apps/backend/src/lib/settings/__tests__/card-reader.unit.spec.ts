jest.mock("../resolve-options", () => {
  const actual = jest.requireActual("../resolve-options");
  return { ...actual, fetchResolvedOptions: jest.fn() };
});

jest.mock("../../../modules/vendor/agreements", () => {
  const actual = jest.requireActual("../../../modules/vendor/agreements");
  return { ...actual, agreementFilesExist: jest.fn() };
});

import { agreementFilesExist } from "../../../modules/vendor/agreements";
import { createCardReader } from "../card-reader";
import * as resolveOptions from "../resolve-options";
import {
  VENDOR_ONBOARDING_DEFAULTS,
  getVendorOnboardingSettings,
} from "../vendor-onboarding";

const actualResolve = jest.requireActual(
  "../resolve-options"
) as typeof resolveOptions;
const fetchMock = resolveOptions.fetchResolvedOptions as jest.Mock;
const filesMock = agreementFilesExist as jest.Mock;

const makeContainer = () => {
  const warn = jest.fn();
  return { container: { resolve: () => ({ warn }) }, warn };
};

const resolved = (options: Record<string, unknown>) => ({
  status: "resolved" as const,
  options,
});

beforeEach(() => {
  fetchMock.mockReset();
  filesMock.mockReset();
  filesMock.mockReturnValue(true);
});

describe("getVendorOnboardingSettings", () => {
  test("returns the stored values when they are valid", async () => {
    fetchMock.mockResolvedValue(
      resolved({ invite_expiry_hours: 24, current_agreement_version: "v2" })
    );
    const { container } = makeContainer();
    await expect(getVendorOnboardingSettings(container)).resolves.toEqual({
      invite_expiry_hours: 24,
      current_agreement_version: "v2",
    });
    expect(filesMock).toHaveBeenCalledWith("v2");
  });

  test.each(["missing", "unsaved", "disabled"] as const)(
    "returns the code defaults for a %s card without throwing",
    async (reason) => {
      fetchMock.mockResolvedValue({ status: "unavailable", reason });
      const { container, warn } = makeContainer();
      await expect(getVendorOnboardingSettings(container)).resolves.toEqual(
        VENDOR_ONBOARDING_DEFAULTS
      );
      expect(warn).not.toHaveBeenCalled();
    }
  );

  test.each([0, 400, "abc", 1.5, -3, null])(
    "falls back to the default hours for %p and logs a [settings] warning",
    async (hours) => {
      fetchMock.mockResolvedValue(resolved({ invite_expiry_hours: hours }));
      const { container, warn } = makeContainer();
      const settings = await getVendorOnboardingSettings(container);
      expect(settings.invite_expiry_hours).toBe(72);
      expect(warn.mock.calls[0][0]).toContain("[settings]");
    }
  );

  test.each([1, 336])("accepts the boundary value %i", async (hours) => {
    fetchMock.mockResolvedValue(resolved({ invite_expiry_hours: hours }));
    const { container } = makeContainer();
    expect(
      (await getVendorOnboardingSettings(container)).invite_expiry_hours
    ).toBe(hours);
  });

  test.each(["../x", "V1", "a b", "", 5])(
    "falls back to the default version for the label %p",
    async (version) => {
      fetchMock.mockResolvedValue(
        resolved({ current_agreement_version: version })
      );
      const { container, warn } = makeContainer();
      const settings = await getVendorOnboardingSettings(container);
      expect(settings.current_agreement_version).toBe("v1-draft");
      expect(warn).toHaveBeenCalled();
    }
  );

  test("falls back to the default version when the documents do not exist", async () => {
    filesMock.mockReturnValue(false);
    fetchMock.mockResolvedValue(
      resolved({ current_agreement_version: "v3" })
    );
    const { container, warn } = makeContainer();
    const settings = await getVendorOnboardingSettings(container);
    expect(settings.current_agreement_version).toBe("v1-draft");
    expect(warn.mock.calls[0][0]).toContain("[settings]");
  });

  test("falls back per field, keeping the valid one", async () => {
    fetchMock.mockResolvedValue(
      resolved({ invite_expiry_hours: 0, current_agreement_version: "v2" })
    );
    const { container } = makeContainer();
    await expect(getVendorOnboardingSettings(container)).resolves.toEqual({
      invite_expiry_hours: 72,
      current_agreement_version: "v2",
    });
  });

  test("keeps the default for a field the card does not carry", async () => {
    fetchMock.mockResolvedValue(resolved({ invite_expiry_hours: 10 }));
    const { container, warn } = makeContainer();
    await expect(getVendorOnboardingSettings(container)).resolves.toEqual({
      invite_expiry_hours: 10,
      current_agreement_version: "v1-draft",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test("is a function of the container: no value survives between calls", async () => {
    const { container: first } = makeContainer();
    const { container: second } = makeContainer();
    fetchMock.mockResolvedValueOnce(resolved({ invite_expiry_hours: 10 }));
    fetchMock.mockResolvedValueOnce(resolved({ invite_expiry_hours: 20 }));
    expect(
      (await getVendorOnboardingSettings(first)).invite_expiry_hours
    ).toBe(10);
    expect(
      (await getVendorOnboardingSettings(second)).invite_expiry_hours
    ).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("reads again on every call with the same container", async () => {
    const { container } = makeContainer();
    fetchMock.mockResolvedValueOnce(resolved({ invite_expiry_hours: 10 }));
    fetchMock.mockResolvedValueOnce({
      status: "unavailable",
      reason: "disabled",
    });
    expect(
      (await getVendorOnboardingSettings(container)).invite_expiry_hours
    ).toBe(10);
    expect(
      (await getVendorOnboardingSettings(container)).invite_expiry_hours
    ).toBe(72);
  });
});

describe("createCardReader", () => {
  test("passes the identifier, returns defaults when unavailable and parse output otherwise", async () => {
    const reader = createCardReader({
      identifier: "integration-example",
      defaults: { n: 1 },
      tag: "example",
      parse: (raw, defaults) => ({
        n: typeof raw.n === "number" ? raw.n : defaults.n,
      }),
    });
    const { container } = makeContainer();

    fetchMock.mockResolvedValueOnce({
      status: "unavailable",
      reason: "missing",
    });
    await expect(reader(container)).resolves.toEqual({ n: 1 });

    fetchMock.mockResolvedValueOnce(resolved({ n: 5 }));
    await expect(reader(container)).resolves.toEqual({ n: 5 });
    expect(fetchMock).toHaveBeenLastCalledWith(
      container,
      "integration-example"
    );
  });

  test("prefixes warnings with the reader's tag", async () => {
    const reader = createCardReader({
      identifier: "integration-example",
      defaults: { n: 1 },
      tag: "example",
      parse: (_raw, defaults, warn) => {
        warn("bad value");
        return defaults;
      },
    });
    const { container, warn } = makeContainer();
    fetchMock.mockResolvedValueOnce(resolved({ n: "x" }));
    await reader(container);
    expect(warn).toHaveBeenCalledWith("[example] bad value");
  });
});

describe("interpretResolved", () => {
  test("nothing or an empty object is an unsaved card", () => {
    expect(actualResolve.interpretResolved(undefined)).toEqual({
      status: "unavailable",
      reason: "unsaved",
    });
    expect(actualResolve.interpretResolved(null)).toEqual({
      status: "unavailable",
      reason: "unsaved",
    });
    expect(actualResolve.interpretResolved({})).toEqual({
      status: "unavailable",
      reason: "unsaved",
    });
  });

  test("enabled false is a disabled card, in both shapes", () => {
    expect(
      actualResolve.interpretResolved({ enabled: false, options: { n: 1 } })
    ).toEqual({
      status: "unavailable",
      reason: "disabled",
    });
    expect(actualResolve.interpretResolved({ enabled: false, n: 1 })).toEqual({
      status: "unavailable",
      reason: "disabled",
    });
  });

  test("observed nested options and flat option values are both resolved", () => {
    expect(actualResolve.interpretResolved({ n: 7 })).toEqual({
      status: "resolved",
      options: { n: 7 },
    });
    expect(
      actualResolve.interpretResolved({
        options: { n: 7 },
        meta: { provider_id: "int_x_default", category: "other", is_enabled: true },
      })
    ).toEqual({
      status: "resolved",
      options: { n: 7 },
    });
  });

  test("meta.is_enabled false maps to disabled", () => {
    expect(
      actualResolve.interpretResolved({
        options: { n: 7 },
        meta: { is_enabled: false },
      })
    ).toEqual({ status: "unavailable", reason: "disabled" });
  });
});

describe("fetchResolvedOptions", () => {
  const containerWith = (
    getResolvedOptions: (
      identifier: string,
      instanceId?: string | null
    ) => Promise<unknown>
  ) => ({
    resolve: () => ({ getResolvedOptions }),
  });

  test("maps the unknown-identifier error to a missing card", async () => {
    const container = containerWith(async () => {
      throw new Error(
        'No integration provider registered for "int_integration-nope_default". Declare it in medusa-config under the integration plugin\'s options.providers.'
      );
    });
    await expect(
      actualResolve.fetchResolvedOptions(container, "integration-nope")
    ).resolves.toEqual({
      status: "unavailable",
      reason: "missing",
    });
  });

  test("maps the not-available error to an unsaved card", async () => {
    const container = containerWith(async () => {
      throw new Error(
        'Integration provider "integration-spike" is not available: it is either not configured, disabled, or missing required options. Configure and enable it before use.'
      );
    });
    await expect(
      actualResolve.fetchResolvedOptions(container, "integration-spike")
    ).resolves.toEqual({
      status: "unavailable",
      reason: "unsaved",
    });
  });

  test("lets any other error propagate", async () => {
    const container = containerWith(async () => {
      throw new Error("database connection lost");
    });
    await expect(
      actualResolve.fetchResolvedOptions(container, "integration-x")
    ).rejects.toThrow("database connection lost");
  });

  test("passes the identifier and default instance id to the module", async () => {
    const getResolvedOptions = jest.fn(async () => ({
      options: { n: 1 },
      meta: { is_enabled: true },
    }));
    await actualResolve.fetchResolvedOptions(
      containerWith(getResolvedOptions),
      "integration-x"
    );
    expect(getResolvedOptions).toHaveBeenCalledWith(
      "integration-x",
      "default"
    );
  });

  test("null from the module is an unsaved card", async () => {
    const container = containerWith(async () => null);
    await expect(
      actualResolve.fetchResolvedOptions(container, "integration-x")
    ).resolves.toEqual({ status: "unavailable", reason: "unsaved" });
  });
});
