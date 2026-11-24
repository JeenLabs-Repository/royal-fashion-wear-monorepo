import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { __resetVendorAdminSectionsForTests } from "../../src/lib/vendor/admin-sections";
import { __resetOnboardingStepsForTests } from "../../src/lib/vendor/onboarding-steps";
import { adminHeadersFor } from "../helpers/admin-as";
import { getVendorSession } from "../helpers/mfa";
import { probe } from "../helpers/staff-users";
import { createVendorFixture } from "../helpers/vendor-fixtures";
import {
  registerStubSection,
  registerStubStep,
  stubPlugin,
} from "../stubs/vendor-compliance-stub";

jest.setTimeout(300 * 1000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("plugin onboarding steps, admin sections and route coverage", () => {
      beforeEach(() => {
        // Complete by default so createVendorFixture can activate active vendors.
        // Tests that prove the gate flip this to false before they activate.
        stubPlugin.stepComplete = true;
        registerStubStep();
        registerStubSection();
      });

      // Registry state is reset between cases. Internal test imports are fine in
      // a spec. The stub itself may not use them.
      afterEach(() => {
        __resetOnboardingStepsForTests();
        __resetVendorAdminSectionsForTests();
      });

      it("shows a plugin step in the vendor's onboarding list as incomplete", async () => {
        stubPlugin.stepComplete = false;
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "plugin step",
          status: "invited",
        });
        const { headers } = await getVendorSession(api, fixture, { enrolled: true });

        const result = await probe(api, headers, "GET", "/vendor/onboarding");
        const steps = (result.body as { steps: any[] }).steps;

        expect(result.status).toBe(200);
        expect(steps.map((step) => step.key)).toEqual(["agreement", "compliance"]);
        expect(steps[1]).toEqual({
          key: "compliance",
          title: "Complete compliance details",
          required_for_activation: true,
          complete: false,
          link: "/compliance",
        });
      });

      it("keeps activation blocked, naming the step, until the step reports complete", async () => {
        stubPlugin.stepComplete = false;
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "plugin step gate",
          status: "invited",
        });
        const headers = await adminHeadersFor(api, container, "superadmin");
        const path = `/admin/vendors/${fixture.vendor_id}/activate`;

        const blocked = await probe(api, headers, "POST", path, {});
        expect(blocked.status).toBe(400);
        expect((blocked.body as { message: string }).message).toContain(
          "Complete compliance details"
        );

        stubPlugin.stepComplete = true;
        const allowed = await probe(api, headers, "POST", path, {});
        expect(allowed.status).toBe(200);
      });

      it("lists the plugin section on the vendor with the vendor id in the path", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "plugin section" });
        const headers = await adminHeadersFor(api, container, "superadmin");

        const result = await probe(
          api,
          headers,
          "GET",
          `/admin/vendors/${fixture.vendor_id}/sections`
        );

        expect((result.body as { sections: unknown[] }).sections).toEqual([
          {
            key: "compliance",
            title: "Compliance",
            path: `/vendors/${fixture.vendor_id}/compliance`,
          },
        ]);
      });

      describe("a vendor path that no route serves yet", () => {
        it("answers 401 without a sign-in", async () => {
          const result = await probe(api, {}, "GET", "/vendor/compliance/ping");
          expect(result.status).toBe(401);
        });

        it("answers 404 to an enrolled active vendor, which proves the chain ran", async () => {
          const fixture = await createVendorFixture(getContainer(), { label: "ping active" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });
          const result = await probe(api, headers, "GET", "/vendor/compliance/ping");
          expect(result.status).toBe(404);
        });

        it("answers 403 to an unenrolled vendor", async () => {
          const fixture = await createVendorFixture(getContainer(), { label: "ping unenrolled" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: false });
          const result = await probe(api, headers, "GET", "/vendor/compliance/ping");
          expect(result.status).toBe(403);
          expect(result.code).toBe("mfa_enrollment_required");
        });

        it("answers 403 to a vendor that is not active yet", async () => {
          const fixture = await createVendorFixture(getContainer(), {
            label: "ping invited",
            status: "invited",
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });
          const result = await probe(api, headers, "GET", "/vendor/compliance/ping");
          expect(result.status).toBe(403);
          expect(result.code).toBe("vendor_not_active");
        });
      });
    });
  },
});
