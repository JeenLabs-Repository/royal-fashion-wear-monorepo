import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { listVendorAdminSections } from "../../src/lib/vendor/admin-sections";
import { getOnboardingSteps } from "../../src/lib/vendor/onboarding-steps";
import { adminHeadersFor } from "../helpers/admin-as";
import { probe } from "../helpers/staff-users";
import { createVendorFixture } from "../helpers/vendor-fixtures";

jest.setTimeout(300 * 1000);

// This file never loads the plugin stub. It shows what happens with no plugin
// installed. Jest gives every spec file its own module registry, so nothing the
// other specs register can reach this one.

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("activation with no plugin installed", () => {
      it("activates a ready vendor on the first call", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "no plugin",
          status: "invited",
        });
        const headers = await adminHeadersFor(api, container, "superadmin");

        const result = await probe(
          api,
          headers,
          "POST",
          `/admin/vendors/${fixture.vendor_id}/activate`,
          {}
        );

        expect(result.status).toBe(200);
        expect((result.body as any).vendor.status).toBe("active");
      });

      it("holds only the built-in onboarding step", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "steps",
          status: "invited",
        });
        const steps = await getOnboardingSteps(container, {
          id: fixture.vendor_id,
          status: "invited",
        });
        expect(steps.map((step) => step.key)).toEqual(["agreement"]);
      });

      it("shows no plugin section on the vendor", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "sections" });
        const headers = await adminHeadersFor(api, container, "superadmin");

        const result = await probe(
          api,
          headers,
          "GET",
          `/admin/vendors/${fixture.vendor_id}/sections`
        );

        expect(listVendorAdminSections(fixture.vendor_id)).toEqual([]);
        expect((result.body as { sections: unknown[] }).sections).toEqual([]);
      });
    });
  },
});
