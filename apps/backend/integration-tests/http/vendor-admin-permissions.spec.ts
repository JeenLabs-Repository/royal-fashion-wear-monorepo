import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { randomBytes } from "node:crypto";
import { adminHeadersFor, type StaffRoleKey } from "../helpers/admin-as";
import { isDenied, probe, secretApiKeyHeaders } from "../helpers/staff-users";
import { createVendorFixture } from "../helpers/vendor-fixtures";

jest.setTimeout(300 * 1000);

const ALL_ROLES: StaffRoleKey[] = [
  "superadmin",
  "catalog_approver",
  "order_router",
  "support",
  "finance_readonly",
];
const READ_ONLY_ROLES = ALL_ROLES.filter((role) => role !== "superadmin");

const location = {
  label: "Permission spec site",
  state_code: "IN-MH",
  pin: "400001",
  address_1: "1 Permission Road",
  pickup_contact_name: "Spec Contact",
  pickup_contact_phone: "+919800000000",
};

// Every mutation route, with a valid body. The ids are placeholders for the
// refusal checks (the manifest refuses before the route runs).
const MUTATIONS: { name: string; path: string; body: unknown }[] = [
  {
    name: "invite",
    path: "/admin/vendors",
    body: { internal_name: "Perm Co", contact_name: "Perm", contact_email: "perm@example.test" },
  },
  { name: "resend invite", path: "/admin/vendors/vnd_x/resend-invite", body: {} },
  { name: "activate", path: "/admin/vendors/vnd_x/activate", body: {} },
  { name: "suspend", path: "/admin/vendors/vnd_x/suspend", body: { reason: "Permission spec reason" } },
  {
    name: "reactivate",
    path: "/admin/vendors/vnd_x/reactivate",
    body: { reason: "Permission spec reason" },
  },
  { name: "location create", path: "/admin/vendors/vnd_x/locations", body: location },
  {
    name: "location update",
    path: "/admin/vendors/vnd_x/locations/vloc_x",
    body: { label: "Renamed" },
  },
];

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("vendor admin permissions", () => {
      describe("reads", () => {
        it.each(ALL_ROLES)("%s may list vendors", async (role) => {
          const headers = await adminHeadersFor(api, getContainer(), role);
          const result = await probe(api, headers, "GET", "/admin/vendors");
          expect(result.status).toBe(200);
        });

        it.each(ALL_ROLES)("%s may read one vendor", async (role) => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: `read ${role}` });
          const headers = await adminHeadersFor(api, container, role);
          const result = await probe(api, headers, "GET", `/admin/vendors/${fixture.vendor_id}`);
          expect(result.status).toBe(200);
        });

        it.each(ALL_ROLES)("%s may read the state coverage and the sections", async (role) => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: `coverage ${role}` });
          const headers = await adminHeadersFor(api, container, role);
          expect((await probe(api, headers, "GET", "/admin/vendors/state-coverage")).status).toBe(200);
          expect(
            (await probe(api, headers, "GET", `/admin/vendors/${fixture.vendor_id}/sections`)).status
          ).toBe(200);
        });
      });

      describe("mutations by roles without vendors:manage", () => {
        it.each(MUTATIONS)("every other role is refused on $name", async ({ path, body }) => {
          const container = getContainer();
          for (const role of READ_ONLY_ROLES) {
            const headers = await adminHeadersFor(api, container, role);
            const result = await probe(api, headers, "POST", path, body);
            expect({ role, denied: isDenied(result), status: result.status }).toEqual({
              role,
              denied: true,
              status: 403,
            });
          }
        });

        it.each(["PUT", "PATCH", "DELETE"])(
          "refuses %s on the vendor family for a read-only role",
          async (method) => {
            const headers = await adminHeadersFor(api, getContainer(), "finance_readonly");
            const result = await probe(api, headers, method, "/admin/vendors/vnd_x");
            expect(isDenied(result)).toBe(true);
          }
        );
      });

      describe("mutations by superadmin", () => {
        const email = () => `perm-${randomBytes(4).toString("hex")}@example.test`;

        it("may invite", async () => {
          const headers = await adminHeadersFor(api, getContainer(), "superadmin");
          const result = await probe(api, headers, "POST", "/admin/vendors", {
            internal_name: "Perm Invite Co",
            contact_name: "Perm Contact",
            contact_email: email(),
          });
          expect(result.status).toBe(200);
        });

        it("may resend an invitation", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "resend",
            status: "invited",
            registered: false,
          });
          const headers = await adminHeadersFor(api, container, "superadmin");
          const result = await probe(
            api,
            headers,
            "POST",
            `/admin/vendors/${fixture.vendor_id}/resend-invite`,
            {}
          );
          expect(result.status).toBe(200);
        });

        it("may activate", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "activate", status: "invited" });
          const headers = await adminHeadersFor(api, container, "superadmin");
          const result = await probe(
            api,
            headers,
            "POST",
            `/admin/vendors/${fixture.vendor_id}/activate`,
            {}
          );
          expect(result.status).toBe(200);
        });

        it("may suspend", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "suspend" });
          const headers = await adminHeadersFor(api, container, "superadmin");
          const result = await probe(
            api,
            headers,
            "POST",
            `/admin/vendors/${fixture.vendor_id}/suspend`,
            { reason: "Permission spec suspension" }
          );
          expect(result.status).toBe(200);
        });

        it("may reactivate", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "reactivate", status: "suspended" });
          const headers = await adminHeadersFor(api, container, "superadmin");
          const result = await probe(
            api,
            headers,
            "POST",
            `/admin/vendors/${fixture.vendor_id}/reactivate`,
            { reason: "Permission spec reactivation" }
          );
          expect(result.status).toBe(200);
        });

        it("may create and update a location", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "locations" });
          const headers = await adminHeadersFor(api, container, "superadmin");

          const created = await probe(
            api,
            headers,
            "POST",
            `/admin/vendors/${fixture.vendor_id}/locations`,
            location
          );
          expect(created.status).toBe(200);
          const id = (created.body as { location: { id: string } }).location.id;

          const updated = await probe(
            api,
            headers,
            "POST",
            `/admin/vendors/${fixture.vendor_id}/locations/${id}`,
            { label: "Renamed by superadmin" }
          );
          expect(updated.status).toBe(200);
        });
      });

      describe("no credentials and API keys", () => {
        it("answers 401 without a sign-in on a read and a write", async () => {
          expect((await probe(api, {}, "GET", "/admin/vendors")).status).toBe(401);
          expect((await probe(api, {}, "POST", "/admin/vendors", {})).status).toBe(401);
        });

        it("refuses a secret API key on a read and a write", async () => {
          const superadmin = await adminHeadersFor(api, getContainer(), "superadmin");
          const keyHeaders = await secretApiKeyHeaders(api, superadmin);

          const read = await probe(api, keyHeaders, "GET", "/admin/vendors");
          const write = await probe(api, keyHeaders, "POST", "/admin/vendors", {
            internal_name: "Key Co",
            contact_name: "Key",
            contact_email: "key@example.test",
          });

          expect(read.status).toBe(403);
          expect(write.status).toBe(403);
          expect(read.code).toBe("api_key_not_allowed");
        });
      });
    });
  },
});
