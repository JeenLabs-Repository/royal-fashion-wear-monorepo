import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { isAgreementCurrent } from "./eligibility";
import { logWith } from "./vendor-module";

export type OnboardingStepContext = {
  container: MedusaContainer;
  vendor: { id: string; status: string };
};

export type OnboardingStepDefinition = {
  key: string;
  title: string;
  required_for_activation: boolean;
  /** A path inside the vendor portal, for example `/agreement`. */
  link?: string;
  isComplete(context: OnboardingStepContext): Promise<boolean>;
};

export type OnboardingStepView = {
  key: string;
  title: string;
  required_for_activation: boolean;
  complete: boolean;
  link?: string;
};

// A single leading slash, then no second slash, backslash or whitespace at the
// start, and no whitespace or backslash anywhere. This rejects https://x,
// //x, javascript:x and /\x.
const SAFE_PORTAL_PATH = /^\/(?:[^/\\\s][^\\\s]*)?$/;

const BUILT_IN_AGREEMENT_STEP: OnboardingStepDefinition = {
  key: "agreement",
  title: "Accept the vendor agreement and packing guideline",
  required_for_activation: true,
  link: "/agreement",
  isComplete: ({ container, vendor }) => isAgreementCurrent(container, vendor.id),
};

// The registry starts with the built-in step so no import order can omit it.
const registry = new Map<string, OnboardingStepDefinition>([
  [BUILT_IN_AGREEMENT_STEP.key, BUILT_IN_AGREEMENT_STEP],
]);

export function registerOnboardingStep(definition: OnboardingStepDefinition): void {
  if (registry.has(definition.key)) {
    throw new MedusaError(
      MedusaError.Types.DUPLICATE_ERROR,
      `An onboarding step with the key "${definition.key}" is already registered.`
    );
  }
  if (definition.link !== undefined && !SAFE_PORTAL_PATH.test(definition.link)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `The onboarding step link "${definition.link}" must be a path inside the portal that starts with one slash.`
    );
  }
  registry.set(definition.key, definition);
}

/**
 * The steps for one vendor, built-in step first. A step whose check throws is
 * reported as incomplete so one broken plugin step cannot break the list.
 */
export async function getOnboardingSteps(
  container: MedusaContainer,
  vendor: { id: string; status: string }
): Promise<OnboardingStepView[]> {
  const views: OnboardingStepView[] = [];
  for (const definition of registry.values()) {
    let complete = false;
    try {
      complete = Boolean(await definition.isComplete({ container, vendor }));
    } catch (error) {
      logWith(
        container,
        "warn",
        `[onboarding] step "${definition.key}" check failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    views.push({
      key: definition.key,
      title: definition.title,
      required_for_activation: definition.required_for_activation,
      complete,
      ...(definition.link ? { link: definition.link } : {}),
    });
  }
  return views;
}

/** Restores the registry to the built-in step. Tests only. */
export function __resetOnboardingStepsForTests(): void {
  registry.clear();
  registry.set(BUILT_IN_AGREEMENT_STEP.key, BUILT_IN_AGREEMENT_STEP);
}
