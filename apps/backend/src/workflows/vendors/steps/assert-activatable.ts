import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { loadVendor } from "../../../lib/vendor/eligibility";
import { getOnboardingSteps } from "../../../lib/vendor/onboarding-steps";
import { getVendorModule } from "../../../lib/vendor/vendor-module";

export const MIN_REASON_LENGTH = 10;
export const REASON_REQUIRED_MESSAGE = "A reason of at least 10 characters is required.";

/** Trims a reason and throws when it is shorter than ten characters. */
export function requireReason(reason: string | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < MIN_REASON_LENGTH) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, REASON_REQUIRED_MESSAGE);
  }
  return trimmed;
}

/**
 * The two things every first activation needs. A user must have accepted the
 * invitation, and every required onboarding step must be complete.
 */
async function assertActivationRequirements(
  container: MedusaContainer,
  vendor: { id: string; status: string }
): Promise<void> {
  const vendorModule = getVendorModule(container);
  const users = await vendorModule.listVendorUsers(
    { vendor_id: vendor.id },
    { select: ["id"], take: null }
  );
  const invites = users.length
    ? await vendorModule.listVendorInvites(
        { vendor_user_id: users.map((user) => user.id) },
        { take: null }
      )
    : [];
  if (!invites.some((invite) => Boolean(invite.used_at))) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "The vendor has not accepted the invitation yet."
    );
  }

  const steps = await getOnboardingSteps(container, vendor);
  const incomplete = steps.filter((step) => step.required_for_activation && !step.complete);
  if (incomplete.length > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Required onboarding steps are incomplete: ${incomplete
        .map((step) => step.title)
        .join(", ")}.`
    );
  }
}

export const assertActivatableStep = createStep(
  "assert-activatable",
  async (input: { vendor_id: string }, { container }) => {
    const vendor = await loadVendor(container, input.vendor_id);
    if (vendor.status === "active") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This vendor is already active.");
    }
    if (vendor.status === "suspended") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This vendor is suspended. Use reactivate instead of activate."
      );
    }
    await assertActivationRequirements(container, vendor);
    return new StepResponse({ vendor_id: vendor.id });
  }
);

export const assertReactivatableStep = createStep(
  "assert-reactivatable",
  async (input: { vendor_id: string; reason: string }, { container }) => {
    const reason = requireReason(input.reason);
    const vendor = await loadVendor(container, input.vendor_id);
    if (vendor.status !== "suspended") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Only a suspended vendor can be reactivated."
      );
    }
    // A vendor suspended before its first activation still has to meet the
    // activation requirements, so reactivation cannot be used to skip them.
    if (!vendor.activated_at) {
      await assertActivationRequirements(container, vendor);
    }
    return new StepResponse({ vendor_id: vendor.id, reason });
  }
);

export const assertSuspendableStep = createStep(
  "assert-suspendable",
  async (input: { vendor_id: string; reason: string }, { container }) => {
    const reason = requireReason(input.reason);
    const vendor = await loadVendor(container, input.vendor_id);
    if (vendor.status === "suspended") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This vendor is already suspended.");
    }
    return new StepResponse({ vendor_id: vendor.id, reason });
  }
);
