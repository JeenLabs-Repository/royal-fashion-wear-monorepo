import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { adminHeadersFor } from "../helpers/admin-as";
import { probe } from "../helpers/staff-users";
import { createVendorFixture } from "../helpers/vendor-fixtures";
import { registerStubPlugin, stubPlugin } from "../stubs/vendor-compliance-stub";

jest.setTimeout(300 * 1000);

registerStubPlugin();

const location = {
  label: "Plugin hook site",
  state_code: "IN-MH",
  pin: "400001",
  address_1: "1 Hook Road",
  pickup_contact_name: "Hook Contact",
  pickup_contact_phone: "+919800000000",
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("plugin hooks on locations, suspension and reactivation", () => {
      beforeEach(() => {
        stubPlugin.enabled = false;
        stubPlugin.activations.length = 0;
        stubPlugin.suspendedSeen.length = 0;
      });

      it("rejects a location create when the plugin rule fails and creates nothing", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "hook create" });
        const headers = await adminHeadersFor(api, container, "superadmin");

        const result = await probe(
          api,
          headers,
          "POST",
          `/admin/vendors/${fixture.vendor_id}/locations`,
          { ...location, pin: "900001" }
        );

        expect(result.status).toBeGreaterThanOrEqual(400);
        expect((result.body as { message: string }).message).toBe(
          "Location rejected by compliance rule"
        );
        expect(
          await getVendorModule(container).listVendorLocations(
            { vendor_id: fixture.vendor_id },
            { take: null }
          )
        ).toHaveLength(0);
      });

      it("accepts a location the plugin rule allows", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "hook allow" });
        const headers = await adminHeadersFor(api, container, "superadmin");

        const result = await probe(
          api,
          headers,
          "POST",
          `/admin/vendors/${fixture.vendor_id}/locations`,
          location
        );

        expect(result.status).toBe(200);
      });

      it("rejects a location update when the plugin rule fails and changes nothing", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "hook update",
          locations: [{ state_code: "IN-MH", pin: "400001" }],
        });
        const headers = await adminHeadersFor(api, container, "superadmin");

        const result = await probe(
          api,
          headers,
          "POST",
          `/admin/vendors/${fixture.vendor_id}/locations/${fixture.locations[0].id}`,
          { pin: "900002" }
        );

        expect((result.body as { message: string }).message).toBe(
          "Location rejected by compliance rule"
        );
        const [row] = await getVendorModule(container).listVendorLocations(
          { id: fixture.locations[0].id },
          { take: 1 }
        );
        expect(row.pin).toBe("400001");
      });

      it("tells the suspension handler the vendor is already suspended and why", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "hook suspend" });
        const headers = await adminHeadersFor(api, container, "superadmin");

        const result = await probe(
          api,
          headers,
          "POST",
          `/admin/vendors/${fixture.vendor_id}/suspend`,
          { reason: "Plugin suspension check" }
        );

        expect(result.status).toBe(200);
        expect(stubPlugin.suspendedSeen).toEqual([
          {
            vendor_id: fixture.vendor_id,
            status: "suspended",
            reason: "Plugin suspension check",
          },
        ]);
      });

      it("runs the activation hook again on reactivation and lets the plugin block it", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "hook reactivate",
          status: "suspended",
        });
        const headers = await adminHeadersFor(api, container, "superadmin");
        const path = `/admin/vendors/${fixture.vendor_id}/reactivate`;
        stubPlugin.activations.length = 0;
        stubPlugin.enabled = true;

        const blocked = await probe(api, headers, "POST", path, {
          reason: "Reactivate under a rule",
        });

        expect((blocked.body as { message: string }).message).toBe(stubPlugin.blockMessage);
        expect(stubPlugin.activations).toEqual([
          { vendor_id: fixture.vendor_id, trigger: "reactivation" },
        ]);

        stubPlugin.enabled = false;
        const allowed = await probe(api, headers, "POST", path, {
          reason: "Reactivate once cleared",
        });
        expect(allowed.status).toBe(200);
        expect((allowed.body as any).vendor.status).toBe("active");
      });
    });
  },
});
