// The extension surface of the vendor module. A plugin imports every extension
// point from this one path and from nothing else in this project.
//
// The names below are stable. Renaming or removing one needs a deprecation
// note in docs/guides/vendor-plugin-extension-points.md and a new export that
// keeps working for one release. A test pins this list, so a change here has
// to be a deliberate edit of that test too.
//
// This file only re-exports. Importing it registers no hook, no onboarding
// step and no admin section.

export {
  onVendorActivating,
  onVendorLocationValidating,
  onVendorSuspended,
} from "../../lib/vendor/hook-helpers";
export { authenticateVendor } from "../../lib/vendor/authenticate-vendor";
export { assertOwns } from "../../lib/vendor/assert-owns";
export { requireVendor } from "../../lib/vendor/vendor-context";
export { defineAllowlistSerializer } from "../../lib/serializers";
export { recordAudit } from "../../lib/audit";
export { registerOnboardingStep } from "../../lib/vendor/onboarding-steps";
export { registerVendorAdminSection } from "../../lib/vendor/admin-sections";
export { VENDOR_MODULE } from "./index";

export type {
  VendorActivatingPayload,
  VendorLocationValidatingPayload,
  VendorSuspendedPayload,
} from "./hook-types";
export type { VendorContext } from "../../lib/vendor/vendor-context";
export type { OnboardingStepDefinition } from "../../lib/vendor/onboarding-steps";
