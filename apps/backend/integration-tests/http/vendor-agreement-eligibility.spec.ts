import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { acceptVendorAgreementWorkflow } from "../../src/workflows/vendors/accept-vendor-agreement";
import {
  assertVendorEligible,
  getVendorEligibility,
  isAgreementCurrent,
} from "../../src/lib/vendor/eligibility";
import { getOnboardingSteps } from "../../src/lib/vendor/onboarding-steps";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";

jest.setTimeout(120 * 1000);

// Mutable settings the mocked reader returns, so a test can change the current
// agreement version the way the settings card will.
const mockSettings = { invite_expiry_hours: 72, current_agreement_version: "v1-draft" };

jest.mock("../../src/lib/settings/vendor-onboarding", () => {
  const actual = jest.requireActual("../../src/lib/settings/vendor-onboarding");
  return {
    ...actual,
    getVendorOnboardingSettings: jest.fn(async () => ({ ...mockSettings })),
  };
});

let counter = 0;

async function makeVendor(
  container: MedusaContainer,
  status: "invited" | "active" | "suspended" = "invited"
) {
  counter += 1;
  const vendorModule = getVendorModule(container);
  const [vendor] = await vendorModule.createVendors([
    {
      internal_name: `Agreement Test Vendor ${counter}`,
      contact_name: "Agreement Tester",
      contact_email: `agreement-${counter}-${Date.now()}@example.test`,
      status,
    },
  ]);
  const [user] = await vendorModule.createVendorUsers([
    {
      vendor_id: vendor.id,
      email: `agreement-user-${counter}-${Date.now()}@example.test`,
      name: "Agreement Tester",
    },
  ]);
  return { vendor, user };
}

const acceptances = (container: MedusaContainer, userId: string) =>
  getVendorModule(container).listVendorAgreementAcceptances(
    { vendor_user_id: userId },
    { take: null }
  );

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("agreement acceptance and vendor eligibility", () => {
      beforeEach(() => {
        mockSettings.current_agreement_version = "v1-draft";
      });

      it("records one acceptance with version, time and address", async () => {
        const container = getContainer();
        const { user } = await makeVendor(container);

        const { result } = await acceptVendorAgreementWorkflow(container).run({
          input: {
            vendor_user_id: user.id,
            version: "v1-draft",
            ip: "203.0.113.7",
            user_agent: "Spec Browser/1.0",
          },
        });

        expect(result.version).toBe("v1-draft");
        expect(new Date(result.accepted_at).getTime()).not.toBeNaN();
        const rows = await acceptances(container, user.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          version: "v1-draft",
          ip: "203.0.113.7",
          user_agent: "Spec Browser/1.0",
        });
      });

      it("truncates the user agent to 200 characters", async () => {
        const container = getContainer();
        const { user } = await makeVendor(container);

        await acceptVendorAgreementWorkflow(container).run({
          input: {
            vendor_user_id: user.id,
            version: "v1-draft",
            user_agent: "A".repeat(500),
          },
        });

        const [row] = await acceptances(container, user.id);
        expect(row.user_agent).toHaveLength(200);
      });

      it("creates no second row for the same user and version and returns the first acceptance", async () => {
        const container = getContainer();
        const { user } = await makeVendor(container);
        const input = { vendor_user_id: user.id, version: "v1-draft" };

        const first = await acceptVendorAgreementWorkflow(container).run({ input });
        const second = await acceptVendorAgreementWorkflow(container).run({ input });

        expect(await acceptances(container, user.id)).toHaveLength(1);
        expect(second.result).toEqual(first.result);
      });

      it("refuses a version that is not the current one with a 409 and a code", async () => {
        const container = getContainer();
        const { user } = await makeVendor(container);

        const error = await acceptVendorAgreementWorkflow(container)
          .run({ input: { vendor_user_id: user.id, version: "v0-old" } })
          .then(
            () => null,
            (caught: unknown) => caught as { type?: string; code?: string; message: string }
          );

        expect(error).not.toBeNull();
        expect(error?.type).toBe("conflict");
        expect(error?.code).toBe("agreement_version_changed");
        expect(error?.message).toBe(
          "The agreement was updated. Reload and read the new version."
        );
        expect(await acceptances(container, user.id)).toHaveLength(0);
      });

      it("refuses an unknown vendor user as not found", async () => {
        await expect(
          acceptVendorAgreementWorkflow(getContainer()).run({
            input: { vendor_user_id: "vusr_missing", version: "v1-draft" },
          })
        ).rejects.toMatchObject({ message: "Not found" });
      });

      it("reopens the agreement step when the card's version changes", async () => {
        const container = getContainer();
        const { vendor, user } = await makeVendor(container);
        await acceptVendorAgreementWorkflow(container).run({
          input: { vendor_user_id: user.id, version: "v1-draft" },
        });

        const view = { id: vendor.id, status: vendor.status };
        const [before] = await getOnboardingSteps(container, view);
        expect(before.complete).toBe(true);

        mockSettings.current_agreement_version = "v2";
        const [after] = await getOnboardingSteps(container, view);
        expect(after.complete).toBe(false);
        expect(await isAgreementCurrent(container, vendor.id)).toBe(false);

        await acceptVendorAgreementWorkflow(container).run({
          input: { vendor_user_id: user.id, version: "v2" },
        });
        expect(await isAgreementCurrent(container, vendor.id)).toBe(true);
      });

      it("lists the built-in step with the documented shape for a fresh vendor", async () => {
        const container = getContainer();
        const { vendor } = await makeVendor(container);

        const steps = await getOnboardingSteps(container, {
          id: vendor.id,
          status: vendor.status,
        });

        expect(steps).toEqual([
          {
            key: "agreement",
            title: "Accept the vendor agreement and packing guideline",
            required_for_activation: true,
            complete: false,
            link: "/agreement",
          },
        ]);
      });

      describe("eligibility truth table", () => {
        const table: {
          label: string;
          status: "invited" | "active" | "suspended";
          accepted: boolean;
          eligible: boolean;
          reasons: string[];
        }[] = [
          {
            label: "invited without acceptance",
            status: "invited",
            accepted: false,
            eligible: false,
            reasons: ["not_active", "agreement_outdated"],
          },
          {
            label: "invited with acceptance",
            status: "invited",
            accepted: true,
            eligible: false,
            reasons: ["not_active"],
          },
          {
            label: "active with the current agreement",
            status: "active",
            accepted: true,
            eligible: true,
            reasons: [],
          },
          {
            label: "active without acceptance",
            status: "active",
            accepted: false,
            eligible: false,
            reasons: ["agreement_outdated"],
          },
          {
            label: "suspended with the current agreement",
            status: "suspended",
            accepted: true,
            eligible: false,
            reasons: ["not_active"],
          },
        ];

        it.each(table)("$label", async ({ status, accepted, eligible, reasons }) => {
          const container = getContainer();
          const { vendor, user } = await makeVendor(container, status);
          if (accepted) {
            await acceptVendorAgreementWorkflow(container).run({
              input: { vendor_user_id: user.id, version: "v1-draft" },
            });
          }

          const result = await getVendorEligibility(container, vendor.id);

          expect(result).toEqual({ eligible, status, reasons });
          if (eligible) {
            await expect(assertVendorEligible(container, vendor.id)).resolves.toBeUndefined();
          } else {
            await expect(
              assertVendorEligible(container, vendor.id)
            ).rejects.toMatchObject({
              type: "not_allowed",
              code: "vendor_ineligible",
              message: "This vendor is not eligible to list products yet.",
            });
          }
        });

        it("turns an active vendor ineligible when the version changes", async () => {
          const container = getContainer();
          const { vendor, user } = await makeVendor(container, "active");
          await acceptVendorAgreementWorkflow(container).run({
            input: { vendor_user_id: user.id, version: "v1-draft" },
          });
          expect((await getVendorEligibility(container, vendor.id)).eligible).toBe(true);

          mockSettings.current_agreement_version = "v2";

          expect(await getVendorEligibility(container, vendor.id)).toEqual({
            eligible: false,
            status: "active",
            reasons: ["agreement_outdated"],
          });
        });
      });
    });
  },
});
