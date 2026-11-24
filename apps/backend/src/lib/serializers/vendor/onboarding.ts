import { defineAllowlistSerializer } from "../define-allowlist-serializer";

export const vendorOnboardingSerializer = defineAllowlistSerializer({
  name: "vendor-onboarding",
  audience: "vendor",
  shape: {
    status: true,
    activation_pending: true,
    steps: {
      key: true,
      title: true,
      required_for_activation: true,
      complete: true,
      link: true,
    },
  },
});
