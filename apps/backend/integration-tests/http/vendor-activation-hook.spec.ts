import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getStoreSalesChannelId } from "../../src/lib/vendor/channel-links";
import { adminHeadersFor } from "../helpers/admin-as";
import { probe } from "../helpers/staff-users";
import { createVendorFixture } from "../helpers/vendor-fixtures";
import { registerStubPlugin, stubPlugin } from "../stubs/vendor-compliance-stub";

jest.setTimeout(300 * 1000);

// Before the application starts, as the hook-registration record describes.
registerStubPlugin();

const isLinked = async (container: MedusaContainer, stockLocationId: string) => {
  const salesChannelId = await getStoreSalesChannelId(container);
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
  };
  const { data } = await query.graph({
    entity: "stock_location",
    fields: ["id", "sales_channels.id"],
    filters: { id: stockLocationId },
  });
  return ((data[0]?.sales_channels ?? []) as ({ id: string } | null)[]).some(
    (channel) => channel?.id === salesChannelId
  );
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("a plugin that blocks activation", () => {
      beforeEach(() => {
        stubPlugin.enabled = false;
        stubPlugin.activations.length = 0;
      });

      it("blocks with its own message, then allows activation once it is disabled", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "stub block",
          status: "invited",
          locations: [{ state_code: "IN-MH", pin: "400001" }],
        });
        const headers = await adminHeadersFor(api, container, "superadmin");
        const activate = `/admin/vendors/${fixture.vendor_id}/activate`;
        stubPlugin.enabled = true;

        const blocked = await probe(api, headers, "POST", activate, {});
        const detail = await probe(api, headers, "GET", `/admin/vendors/${fixture.vendor_id}`);

        expect(blocked.status).toBeGreaterThanOrEqual(400);
        expect((blocked.body as { message: string }).message).toBe(stubPlugin.blockMessage);
        expect((detail.body as any).vendor.status).toBe("invited");
        expect(await isLinked(container, fixture.locations[0].stock_location_id)).toBe(false);

        stubPlugin.enabled = false;
        const allowed = await probe(api, headers, "POST", activate, {});
        expect(allowed.status).toBe(200);
        expect((allowed.body as any).vendor.status).toBe("active");
        expect(await isLinked(container, fixture.locations[0].stock_location_id)).toBe(true);
      });

      it("does not block while the plugin is disabled and still sees the activation", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "stub open",
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
        expect(stubPlugin.activations).toEqual([
          { vendor_id: fixture.vendor_id, trigger: "activation" },
        ]);
      });

      it("is asked before any state changes, so the status stays as it was", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "stub unchanged",
          status: "invited",
        });
        const headers = await adminHeadersFor(api, container, "superadmin");
        stubPlugin.enabled = true;

        await probe(api, headers, "POST", `/admin/vendors/${fixture.vendor_id}/activate`, {});
        const detail = (
          await probe(api, headers, "GET", `/admin/vendors/${fixture.vendor_id}`)
        ).body as any;

        expect(detail.vendor.status).toBe("invited");
        expect(detail.vendor.activated_at).toBeNull();
      });
    });
  },
});
