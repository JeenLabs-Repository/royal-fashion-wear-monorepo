import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { randomBytes } from "node:crypto";
import { registerVendorAdminSection } from "../../src/lib/vendor/admin-sections";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { vendorActivationGateWorkflow } from "../../src/workflows/vendors/vendor-activation-gate";
import { adminHeadersFor } from "../helpers/admin-as";
import { findAuditEntries } from "../helpers/audit";
import { probe } from "../helpers/staff-users";
import { createVendorFixture } from "../helpers/vendor-fixtures";

jest.setTimeout(300 * 1000);

// Registered at module load, before the application starts, the way the
// hook-registration record describes. A flag decides whether a handler blocks.
const hookState = { block: false, triggers: [] as string[] };

vendorActivationGateWorkflow.hooks.vendorActivating(async ({ trigger }) => {
  hookState.triggers.push(trigger);
  if (hookState.block) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Compliance check pending");
  }
});

registerVendorAdminSection({
  key: "compliance",
  title: "Compliance",
  path: "/vendors/:vendorId/compliance",
});

const location = {
  label: "Admin api spec site",
  state_code: "IN-MH",
  pin: "400001",
  address_1: "1 Admin Road",
  pickup_contact_name: "Spec Contact",
  pickup_contact_phone: "+919800000000",
};

const email = () => `admin-api-${randomBytes(4).toString("hex")}@example.test`;

const bodyOf = (result: { body?: Record<string, unknown> }) => result.body as any;

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    const superadmin = (container: MedusaContainer = getContainer()) =>
      adminHeadersFor(api, container, "superadmin");

    describe("vendor admin api", () => {
      beforeEach(() => {
        hookState.block = false;
        hookState.triggers.length = 0;
      });

      describe("invite and the activation flow", () => {
        it("invites a vendor and lists it without any token or link", async () => {
          const headers = await superadmin();
          const contactEmail = email();

          const invited = await probe(api, headers, "POST", "/admin/vendors", {
            internal_name: "Flow Invite Traders",
            contact_name: "Flow Contact",
            contact_email: contactEmail,
          });
          const listed = await probe(api, headers, "GET", "/admin/vendors?q=Flow%20Invite");

          expect([200, 201]).toContain(invited.status);
          expect(bodyOf(invited).vendor.status).toBe("invited");
          expect(bodyOf(invited).invite.expires_at).toBeTruthy();
          expect(bodyOf(listed).vendors).toHaveLength(1);
          for (const text of [JSON.stringify(invited.body), JSON.stringify(listed.body)]) {
            expect(text).not.toContain("#token=");
            expect(text).not.toContain("accept-invite");
            expect(text).not.toContain("token_hash");
          }
        });

        it("refuses activation before the vendor registers, with the readable message", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "not registered",
            status: "invited",
            registered: false,
          });
          const result = await probe(
            api,
            await superadmin(container),
            "POST",
            `/admin/vendors/${fixture.vendor_id}/activate`,
            {}
          );
          expect(result.status).toBe(400);
          expect(bodyOf(result).message).toBe("The vendor has not accepted the invitation yet.");
        });

        it("refuses activation without the agreement and names the step", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "no agreement",
            status: "invited",
            acceptAgreement: false,
          });
          const result = await probe(
            api,
            await superadmin(container),
            "POST",
            `/admin/vendors/${fixture.vendor_id}/activate`,
            {}
          );
          expect(result.status).toBe(400);
          expect(bodyOf(result).message).toContain(
            "Accept the vendor agreement and packing guideline"
          );
        });

        it("activates a registered vendor that accepted the agreement", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "ready",
            status: "invited",
            locations: [{ state_code: "IN-MH", pin: "400001" }],
          });
          const headers = await superadmin(container);

          const activated = await probe(
            api,
            headers,
            "POST",
            `/admin/vendors/${fixture.vendor_id}/activate`,
            {}
          );
          const detail = await probe(api, headers, "GET", `/admin/vendors/${fixture.vendor_id}`);

          expect(activated.status).toBe(200);
          expect(bodyOf(activated).vendor.status).toBe("active");
          expect(bodyOf(detail).vendor.eligible_to_list).toBe(true);
          expect(bodyOf(detail).vendor.locations_count).toBe(1);
          expect(hookState.triggers).toEqual(["activation"]);
        });

        it("shows a blocking handler's message verbatim and keeps the vendor invited", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "blocked", status: "invited" });
          const headers = await superadmin(container);
          hookState.block = true;

          const blocked = await probe(
            api,
            headers,
            "POST",
            `/admin/vendors/${fixture.vendor_id}/activate`,
            {}
          );
          const detail = await probe(api, headers, "GET", `/admin/vendors/${fixture.vendor_id}`);

          expect(blocked.status).toBeGreaterThanOrEqual(400);
          expect(bodyOf(blocked).message).toBe("Compliance check pending");
          expect(bodyOf(detail).vendor.status).toBe("invited");
        });

        it("runs the same hook on reactivation and shows its message", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "blocked again", status: "suspended" });
          const headers = await superadmin(container);
          // Building a suspended fixture ran the hook once for the activation.
          hookState.triggers.length = 0;
          hookState.block = true;

          const blocked = await probe(
            api,
            headers,
            "POST",
            `/admin/vendors/${fixture.vendor_id}/reactivate`,
            { reason: "Reactivation under a rule" }
          );

          expect(bodyOf(blocked).message).toBe("Compliance check pending");
          expect(hookState.triggers).toEqual(["reactivation"]);
        });
      });

      describe("suspension and reactivation", () => {
        it("rejects a 9 character reason and accepts 10 or more", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "reasons" });
          const headers = await superadmin(container);
          const path = `/admin/vendors/${fixture.vendor_id}/suspend`;

          expect((await probe(api, headers, "POST", path, { reason: "123456789" })).status).toBe(400);
          const ok = await probe(api, headers, "POST", path, { reason: "1234567890" });
          expect(ok.status).toBe(200);
          expect(bodyOf(ok).vendor.status).toBe("suspended");

          const back = await probe(
            api,
            headers,
            "POST",
            `/admin/vendors/${fixture.vendor_id}/reactivate`,
            { reason: "Problem solved with vendor" }
          );
          expect(back.status).toBe(200);
          expect(bodyOf(back).vendor.status).toBe("active");
        });

        it("keeps the audit trail for every lifecycle action and location change", async () => {
          const container = getContainer();
          const headers = await superadmin(container);

          const invited = await probe(api, headers, "POST", "/admin/vendors", {
            internal_name: "Audit Trail Traders",
            contact_name: "Audit Contact",
            contact_email: email(),
          });
          expect(invited.status).toBe(200);

          const fixture = await createVendorFixture(container, { label: "audit", status: "invited" });
          const base = `/admin/vendors/${fixture.vendor_id}`;
          const created = await probe(api, headers, "POST", `${base}/locations`, location);
          const locationId = bodyOf(created).location.id;
          await probe(api, headers, "POST", `${base}/locations/${locationId}`, { label: "Changed" });
          await probe(api, headers, "POST", `${base}/activate`, {});
          await probe(api, headers, "POST", `${base}/suspend`, { reason: "Audit spec suspension" });
          await probe(api, headers, "POST", `${base}/reactivate`, { reason: "Audit spec reactivation" });

          for (const action of [
            "vendor.invited",
            "vendor.activated",
            "vendor.suspended",
            "vendor.reactivated",
            "vendor.location_created",
            "vendor.location_updated",
          ]) {
            const entries = await findAuditEntries(container, { action });
            expect({ action, found: entries.length > 0 }).toEqual({ action, found: true });
          }
        });
      });

      describe("strict bodies", () => {
        it.each([
          ["invite", "/admin/vendors", { internal_name: "X", contact_name: "Y", contact_email: "x@example.test", extra: 1 }],
          ["resend invite", "/admin/vendors/vnd_x/resend-invite", { extra: 1 }],
          ["activate", "/admin/vendors/vnd_x/activate", { extra: 1 }],
          ["suspend", "/admin/vendors/vnd_x/suspend", { reason: "Long enough reason", extra: 1 }],
          ["reactivate", "/admin/vendors/vnd_x/reactivate", { reason: "Long enough reason", extra: 1 }],
          ["location create", "/admin/vendors/vnd_x/locations", { ...location, extra: 1 }],
          ["location update", "/admin/vendors/vnd_x/locations/vloc_x", { label: "A", code: "LOC-0001" }],
        ])("answers 400 for an unknown key on %s", async (_name, path, body) => {
          const result = await probe(api, await superadmin(), "POST", path, body);
          expect(result.status).toBe(400);
        });

        it("answers 400 for an empty location update", async () => {
          const result = await probe(
            api,
            await superadmin(),
            "POST",
            "/admin/vendors/vnd_x/locations/vloc_x",
            {}
          );
          expect(result.status).toBe(400);
        });
      });

      describe("locations", () => {
        it("creates a location with a LOC code and keeps the code on update", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "loc flow" });
          const headers = await superadmin(container);
          const base = `/admin/vendors/${fixture.vendor_id}/locations`;

          const created = await probe(api, headers, "POST", base, location);
          const first = bodyOf(created).location;
          const updated = await probe(api, headers, "POST", `${base}/${first.id}`, {
            label: "Renamed by the owner",
          });

          expect(first.code).toMatch(/^LOC-\d{4}$/);
          expect(bodyOf(updated).location.label).toBe("Renamed by the owner");
          expect(bodyOf(updated).location.code).toBe(first.code);
        });

        it("answers 404 for a location that belongs to another vendor", async () => {
          const container = getContainer();
          const owner = await createVendorFixture(container, {
            label: "loc owner",
            locations: [{ state_code: "IN-MH", pin: "400001" }],
          });
          const other = await createVendorFixture(container, { label: "loc other" });

          const result = await probe(
            api,
            await superadmin(container),
            "POST",
            `/admin/vendors/${other.vendor_id}/locations/${owner.locations[0].id}`,
            { label: "Hijacked" }
          );

          expect(result.status).toBe(404);
          const [row] = await getVendorModule(container).listVendorLocations(
            { id: owner.locations[0].id },
            { take: 1 }
          );
          expect(row.label).not.toBe("Hijacked");
        });
      });

      describe("state coverage", () => {
        it("flags a state served by exactly one active vendor and drops it after suspension", async () => {
          const container = getContainer();
          const headers = await superadmin(container);
          const first = await createVendorFixture(container, {
            label: "cover one",
            locations: [
              { state_code: "IN-MH", pin: "400001" },
              { state_code: "IN-KA", pin: "560001" },
            ],
          });
          await createVendorFixture(container, {
            label: "cover two",
            locations: [{ state_code: "IN-MH", pin: "400002" }],
          });

          const before = bodyOf(await probe(api, headers, "GET", "/admin/vendors/state-coverage"));
          expect(before.states).toEqual([
            expect.objectContaining({ state_code: "IN-KA", single_vendor: true, active_vendor_count: 1 }),
            expect.objectContaining({ state_code: "IN-MH", single_vendor: false, active_vendor_count: 2 }),
          ]);

          await probe(api, headers, "POST", `/admin/vendors/${first.vendor_id}/suspend`, {
            reason: "Coverage spec suspension",
          });
          const after = bodyOf(await probe(api, headers, "GET", "/admin/vendors/state-coverage"));
          expect(after.states.map((state: { state_code: string }) => state.state_code)).toEqual([
            "IN-MH",
          ]);
          expect(after.states[0].single_vendor).toBe(true);
        });

        it("is answered by its own route, not by the vendor detail route", async () => {
          const result = await probe(api, await superadmin(), "GET", "/admin/vendors/state-coverage");
          expect(result.status).toBe(200);
          expect(bodyOf(result)).toHaveProperty("states");
          expect(bodyOf(result)).not.toHaveProperty("vendor");
        });
      });

      describe("list and detail", () => {
        it("filters by status and searches names with wildcards treated as text", async () => {
          const container = getContainer();
          const vendorModule = getVendorModule(container);
          await vendorModule.createVendors([
            { internal_name: "Alpha_Co", contact_name: "A", contact_email: email(), status: "active" },
            { internal_name: "AlphaXCo", contact_name: "B", contact_email: email(), status: "suspended" },
          ]);
          const headers = await superadmin(container);

          const underscore = bodyOf(await probe(api, headers, "GET", "/admin/vendors?q=Alpha_"));
          const suspended = bodyOf(await probe(api, headers, "GET", "/admin/vendors?status=suspended"));

          expect(underscore.vendors.map((v: { internal_name: string }) => v.internal_name)).toEqual([
            "Alpha_Co",
          ]);
          expect(suspended.vendors.map((v: { internal_name: string }) => v.internal_name)).toEqual([
            "AlphaXCo",
          ]);
        });

        it("paginates and reports the total", async () => {
          const container = getContainer();
          await createVendorFixture(container, { label: "page 1", status: "invited", registered: false });
          await createVendorFixture(container, { label: "page 2", status: "invited", registered: false });
          await createVendorFixture(container, { label: "page 3", status: "invited", registered: false });

          const page = bodyOf(
            await probe(api, await superadmin(container), "GET", "/admin/vendors?limit=2&offset=0")
          );

          expect(page.vendors).toHaveLength(2);
          expect(page.count).toBe(3);
          expect(page.limit).toBe(2);
          expect(page.offset).toBe(0);
        });

        it("warns while the agreement is still the draft placeholder", async () => {
          const result = await probe(api, await superadmin(), "GET", "/admin/vendors");
          expect(bodyOf(result).warnings).toContain("agreement_is_draft");
        });

        it("rejects an unknown query key and an out of range limit", async () => {
          const headers = await superadmin();
          expect((await probe(api, headers, "GET", "/admin/vendors?vendor_id=x")).status).toBe(400);
          expect((await probe(api, headers, "GET", "/admin/vendors?limit=101")).status).toBe(400);
        });

        it("returns the full detail with user, invitation state, locations and steps", async () => {
          const container = getContainer();
          const waiting = await createVendorFixture(container, {
            label: "detail waiting",
            status: "invited",
            registered: false,
          });
          const done = await createVendorFixture(container, {
            label: "detail done",
            locations: [{ state_code: "IN-MH", pin: "400001" }],
          });
          const headers = await superadmin(container);

          const pending = bodyOf(
            await probe(api, headers, "GET", `/admin/vendors/${waiting.vendor_id}`)
          ).vendor;
          const used = bodyOf(await probe(api, headers, "GET", `/admin/vendors/${done.vendor_id}`))
            .vendor;

          expect(pending.user).toMatchObject({ registered: false, invite_state: "pending" });
          expect(used.user).toMatchObject({ registered: true, invite_state: "used" });
          expect(used.onboarding_steps.map((step: { key: string }) => step.key)).toEqual(["agreement"]);
          expect(used.locations[0]).toHaveProperty("stock_location_id");
          expect(used.locations[0].state_name).toBe("Maharashtra");
          expect(JSON.stringify(used)).not.toContain("token_hash");
        });

        it("answers 404 for an unknown vendor on detail and on sections", async () => {
          const headers = await superadmin();
          expect((await probe(api, headers, "GET", "/admin/vendors/vnd_missing")).status).toBe(404);
          expect((await probe(api, headers, "GET", "/admin/vendors/vnd_missing/sections")).status).toBe(
            404
          );
        });
      });

      describe("plugin sections", () => {
        it("returns the registered sections with the vendor id put into the path", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "sections" });

          const result = await probe(
            api,
            await superadmin(container),
            "GET",
            `/admin/vendors/${fixture.vendor_id}/sections`
          );

          expect(result.status).toBe(200);
          expect(bodyOf(result).sections).toEqual([
            {
              key: "compliance",
              title: "Compliance",
              path: `/vendors/${fixture.vendor_id}/compliance`,
            },
          ]);
        });
      });

      describe("secrecy", () => {
        it("never returns an invite link or token from any admin vendor response", async () => {
          const container = getContainer();
          const headers = await superadmin(container);
          const waiting = await createVendorFixture(container, {
            label: "secrecy",
            status: "invited",
            registered: false,
          });
          const responses = [
            await probe(api, headers, "GET", "/admin/vendors"),
            await probe(api, headers, "GET", `/admin/vendors/${waiting.vendor_id}`),
            await probe(api, headers, "POST", `/admin/vendors/${waiting.vendor_id}/resend-invite`, {}),
          ];
          for (const response of responses) {
            const text = JSON.stringify(response.body);
            expect(text).not.toContain("#token=");
            expect(text).not.toContain("accept-invite");
            expect(text).not.toContain("accept_url");
          }
        });
      });
    });
  },
});
