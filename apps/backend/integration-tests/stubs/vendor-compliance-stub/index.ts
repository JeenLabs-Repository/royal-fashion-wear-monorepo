// A test-only stand-in for a compliance plugin. It imports from the backend
// source through the public surface and nowhere else, which is what proves
// the surface is enough for a real plugin. It is never imported by the
// application. Nothing registers when this file is imported. A spec calls the
// register functions it needs before the application starts.

import { MedusaError } from "@medusajs/framework/utils";
import {
  VENDOR_MODULE,
  onVendorActivating,
  onVendorLocationValidating,
  onVendorSuspended,
  registerOnboardingStep,
  registerVendorAdminSection,
} from "../../../src/modules/vendor/public";

type VendorReader = {
  listVendors(filter: Record<string, unknown>, config?: Record<string, unknown>): Promise<
    { id: string; status: string }[]
  >;
};

export const stubPlugin = {
  enabled: false,
  blockMessage: "Compliance check pending: tax details not verified",
  locationRejectPrefix: "9",
  stepComplete: false,
  activations: [] as { vendor_id: string; trigger: string }[],
  suspendedSeen: [] as { vendor_id: string; status?: string; reason: string }[],
};

/** Attaches the three hook handlers. Call once per spec file, before the app starts. */
export function registerStubPlugin(): void {
  onVendorActivating(async ({ vendor_id, trigger }) => {
    stubPlugin.activations.push({ vendor_id, trigger });
    if (stubPlugin.enabled) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, stubPlugin.blockMessage);
    }
  });

  onVendorLocationValidating(async ({ proposed }) => {
    if (proposed.pin.startsWith(stubPlugin.locationRejectPrefix)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Location rejected by compliance rule"
      );
    }
  });

  onVendorSuspended(async ({ vendor_id, reason }, { container }) => {
    const vendors = container.resolve<VendorReader>(VENDOR_MODULE);
    const [vendor] = await vendors.listVendors({ id: vendor_id }, { take: 1 });
    stubPlugin.suspendedSeen.push({ vendor_id, status: vendor?.status, reason });
  });
}

/** A required onboarding step that is complete only while `stepComplete` is true. */
export function registerStubStep(): void {
  registerOnboardingStep({
    key: "compliance",
    title: "Complete compliance details",
    required_for_activation: true,
    link: "/compliance",
    isComplete: async () => stubPlugin.stepComplete,
  });
}

/** A link on the vendor detail page. */
export function registerStubSection(): void {
  registerVendorAdminSection({
    key: "compliance",
    title: "Compliance",
    path: "/vendors/:vendorId/compliance",
  });
}
