import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  VENDOR_ONBOARDING_DEFAULTS,
  getVendorOnboardingSettings,
} from "../../src/lib/settings/vendor-onboarding";

jest.setTimeout(120 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    describe("vendor onboarding settings reader", () => {
      it("returns the code defaults when no card is registered", async () => {
        await expect(
          getVendorOnboardingSettings(getContainer())
        ).resolves.toEqual(VENDOR_ONBOARDING_DEFAULTS);
      });

      it("does not throw and gives the same answer on a second read", async () => {
        const first = await getVendorOnboardingSettings(getContainer());
        const second = await getVendorOnboardingSettings(getContainer());
        expect(second).toEqual(first);
        expect(second.invite_expiry_hours).toBe(72);
        expect(second.current_agreement_version).toBe("v1-draft");
      });
    });
  },
});
