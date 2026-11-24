import type { MedusaContainer } from "@medusajs/framework/types";
import { isAgreementCurrent } from "../eligibility";
import {
  __resetOnboardingStepsForTests,
  getOnboardingSteps,
  registerOnboardingStep,
} from "../onboarding-steps";

jest.mock("../eligibility", () => ({
  isAgreementCurrent: jest.fn(),
}));

const isAgreementCurrentMock = isAgreementCurrent as jest.MockedFunction<
  typeof isAgreementCurrent
>;

const warn = jest.fn();
const container = {
  resolve: (key: string) => {
    if (key === "logger") {
      return { info: jest.fn(), warn, error: jest.fn() };
    }
    throw new Error(`unexpected resolve ${key}`);
  },
} as unknown as MedusaContainer;

const vendor = { id: "vnd_1", status: "invited" };

beforeEach(() => {
  __resetOnboardingStepsForTests();
  isAgreementCurrentMock.mockReset();
  isAgreementCurrentMock.mockResolvedValue(false);
  warn.mockClear();
});

describe("built-in agreement step", () => {
  test("is the only step by default and is incomplete without an acceptance", async () => {
    await expect(getOnboardingSteps(container, vendor)).resolves.toEqual([
      {
        key: "agreement",
        title: "Accept the vendor agreement and packing guideline",
        required_for_activation: true,
        complete: false,
        link: "/agreement",
      },
    ]);
  });

  test("is complete while the current version is accepted", async () => {
    isAgreementCurrentMock.mockResolvedValue(true);
    const [step] = await getOnboardingSteps(container, vendor);
    expect(step.complete).toBe(true);
    expect(isAgreementCurrentMock).toHaveBeenCalledWith(container, "vnd_1");
  });

  test("becomes incomplete again when the current version stops matching", async () => {
    isAgreementCurrentMock.mockResolvedValueOnce(true);
    isAgreementCurrentMock.mockResolvedValueOnce(false);
    const [before] = await getOnboardingSteps(container, vendor);
    const [after] = await getOnboardingSteps(container, vendor);
    expect([before.complete, after.complete]).toEqual([true, false]);
  });
});

describe("registerOnboardingStep", () => {
  test("adds a step after the built-in one", async () => {
    registerOnboardingStep({
      key: "compliance",
      title: "Complete compliance details",
      required_for_activation: false,
      link: "/compliance",
      isComplete: async () => true,
    });
    const steps = await getOnboardingSteps(container, vendor);
    expect(steps.map((step) => step.key)).toEqual(["agreement", "compliance"]);
    expect(steps[1]).toEqual({
      key: "compliance",
      title: "Complete compliance details",
      required_for_activation: false,
      complete: true,
      link: "/compliance",
    });
  });

  test("omits the link key for a step without a link", async () => {
    registerOnboardingStep({
      key: "plain",
      title: "Plain step",
      required_for_activation: false,
      isComplete: async () => false,
    });
    const steps = await getOnboardingSteps(container, vendor);
    expect("link" in steps[1]).toBe(false);
  });

  test("rejects a duplicate key", () => {
    const definition = {
      key: "compliance",
      title: "Complete compliance details",
      required_for_activation: false,
      isComplete: async () => true,
    };
    registerOnboardingStep(definition);
    expect(() => registerOnboardingStep(definition)).toThrow(/already registered/);
    expect(() =>
      registerOnboardingStep({ ...definition, key: "agreement" })
    ).toThrow(/already registered/);
  });

  test.each([
    ["an absolute url", "https://example.test/x"],
    ["a protocol-relative url", "//example.test/x"],
    ["a script scheme", "javascript:alert(1)"],
    ["a relative path without a slash", "agreement"],
    ["a backslash after the slash", "/\\example.test"],
    ["whitespace", "/has space"],
  ])("rejects a link that is %s", (_label, link) => {
    expect(() =>
      registerOnboardingStep({
        key: `bad-${_label}`,
        title: "Bad link",
        required_for_activation: false,
        link,
        isComplete: async () => true,
      })
    ).toThrow(/must be a path inside the portal/);
  });

  test.each(["/", "/compliance", "/compliance/details?tab=1"])(
    "accepts the link %s",
    (link) => {
      expect(() =>
        registerOnboardingStep({
          key: `ok-${link}`,
          title: "Good link",
          required_for_activation: false,
          link,
          isComplete: async () => true,
        })
      ).not.toThrow();
    }
  );
});

describe("a step whose check throws", () => {
  test("is reported incomplete, logs a warning and leaves the other steps intact", async () => {
    isAgreementCurrentMock.mockResolvedValue(true);
    registerOnboardingStep({
      key: "broken",
      title: "Broken step",
      required_for_activation: true,
      isComplete: async () => {
        throw new Error("plugin exploded");
      },
    });
    const steps = await getOnboardingSteps(container, vendor);
    expect(steps.map((step) => [step.key, step.complete])).toEqual([
      ["agreement", true],
      ["broken", false],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("[onboarding]");
    expect(warn.mock.calls[0][0]).toContain("plugin exploded");
  });
});

describe("__resetOnboardingStepsForTests", () => {
  test("removes registered steps and keeps the built-in one", async () => {
    registerOnboardingStep({
      key: "temporary",
      title: "Temporary",
      required_for_activation: false,
      isComplete: async () => true,
    });
    __resetOnboardingStepsForTests();
    const steps = await getOnboardingSteps(container, vendor);
    expect(steps.map((step) => step.key)).toEqual(["agreement"]);
  });
});
