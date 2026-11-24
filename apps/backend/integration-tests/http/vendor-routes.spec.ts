import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { assertOutputWithinAllowlist } from "../../src/lib/serializers";
import { vendorAgreementSerializer } from "../../src/lib/serializers/vendor/agreement";
import { vendorLocationSerializer } from "../../src/lib/serializers/vendor/location";
import { vendorOnboardingSerializer } from "../../src/lib/serializers/vendor/onboarding";
import { vendorSelfSerializer, vendorUserSerializer } from "../../src/lib/serializers/vendor/self";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { getVendorSession } from "../helpers/mfa";
import { probe, waitForAuditEntry } from "../helpers/staff-users";
import { createVendorFixture } from "../helpers/vendor-fixtures";

jest.setTimeout(300 * 1000);

const CANARY_NOTE = "CANARY-OWNER-NOTE-7731";
const CANARY_REASON = "CANARY-SUSPEND-REASON-7731";
const AGREEMENT_BODY = { version: "v1-draft", accepted: true };

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("vendor routes", () => {
      describe("GET /vendor/me", () => {
        it("returns allowlisted keys for the vendor and the user", async () => {
          const fixture = await createVendorFixture(getContainer(), { label: "me shape" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          const result = await probe(api, headers, "GET", "/vendor/me");
          const body = result.body as any;

          expect(result.status).toBe(200);
          expect(Object.keys(body).sort()).toEqual(["mfa_enabled", "user", "vendor"]);
          assertOutputWithinAllowlist(body.vendor, vendorSelfSerializer.allowedPaths);
          assertOutputWithinAllowlist(body.user, vendorUserSerializer.allowedPaths);
          expect(body.vendor.status).toBe("active");
          expect(body.vendor.eligible_to_list).toBe(true);
          expect(body.user.email).toBe(fixture.email);
          expect(body.mfa_enabled).toBe(true);
        });

        it("marks an invited vendor as not eligible to list yet", async () => {
          const fixture = await createVendorFixture(getContainer(), {
            label: "me invited",
            status: "invited",
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          const body = (await probe(api, headers, "GET", "/vendor/me")).body as any;

          expect(body.vendor.status).toBe("invited");
          expect(body.vendor.eligible_to_list).toBe(false);
          expect(body.vendor.activated_at).toBeNull();
        });

        it("never returns the owner's note or the suspension reason", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "me canary" });
          await getVendorModule(container).updateVendors([
            { id: fixture.vendor_id, note: CANARY_NOTE, suspend_reason: CANARY_REASON },
          ] as never);
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          const text = JSON.stringify((await probe(api, headers, "GET", "/vendor/me")).body);

          expect(text).not.toContain("CANARY-");
          expect(text).not.toContain('"note"');
          expect(text).not.toContain("suspend_reason");
        });
      });

      describe("GET /vendor/onboarding", () => {
        it("lists the agreement step, open before acceptance and complete after", async () => {
          const fixture = await createVendorFixture(getContainer(), {
            label: "onboarding steps",
            status: "invited",
            acceptAgreement: false,
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          const before = (await probe(api, headers, "GET", "/vendor/onboarding")).body as any;
          expect(before.status).toBe("invited");
          expect(before.activation_pending).toBe(false);
          expect(before.steps).toEqual([
            {
              key: "agreement",
              title: "Accept the vendor agreement and packing guideline",
              required_for_activation: true,
              complete: false,
              link: "/agreement",
            },
          ]);
          assertOutputWithinAllowlist(before, vendorOnboardingSerializer.allowedPaths);

          await probe(api, headers, "POST", "/vendor/agreement/accept", AGREEMENT_BODY);

          const after = (await probe(api, headers, "GET", "/vendor/onboarding")).body as any;
          expect(after.steps[0].complete).toBe(true);
          expect(after.activation_pending).toBe(true);
        });

        it("reports no pending activation for a vendor that is already active", async () => {
          const fixture = await createVendorFixture(getContainer(), { label: "already active" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });
          const body = (await probe(api, headers, "GET", "/vendor/onboarding")).body as any;
          expect(body.status).toBe("active");
          expect(body.activation_pending).toBe(false);
        });
      });

      describe("agreement routes", () => {
        it("returns the two documents and the acceptance state", async () => {
          const fixture = await createVendorFixture(getContainer(), {
            label: "agreement read",
            status: "invited",
            acceptAgreement: false,
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          const body = (await probe(api, headers, "GET", "/vendor/agreement/current"))
            .body as any;

          expect(body.version).toBe("v1-draft");
          expect(body.accepted).toBe(false);
          expect(body.accepted_at).toBeNull();
          expect(body.documents.map((document: { key: string }) => document.key)).toEqual([
            "agreement",
            "packing-guideline",
          ]);
          expect(body.documents[0].markdown).toContain("DRAFT PLACEHOLDER");
          assertOutputWithinAllowlist(body, vendorAgreementSerializer.allowedPaths);
        });

        it("records one acceptance with address and user agent, and a second call adds none", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "agreement accept",
            status: "invited",
            acceptAgreement: false,
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });
          const withAgent = { ...headers, "user-agent": "Spec Agent/1.0" };

          const first = await probe(api, withAgent, "POST", "/vendor/agreement/accept", AGREEMENT_BODY);
          const second = await probe(api, withAgent, "POST", "/vendor/agreement/accept", AGREEMENT_BODY);

          expect(first.status).toBe(200);
          expect(second.status).toBe(200);
          const rows = await getVendorModule(container).listVendorAgreementAcceptances(
            { vendor_user_id: fixture.user_id },
            { take: null }
          );
          expect(rows).toHaveLength(1);
          expect(rows[0].ip).toBeTruthy();
          expect(rows[0].user_agent).toBe("Spec Agent/1.0");

          const current = (await probe(api, headers, "GET", "/vendor/agreement/current")).body as any;
          expect(current.accepted).toBe(true);
          expect(current.accepted_at).not.toBeNull();
        });

        it("answers 409 with a code for a version that is not the current one", async () => {
          const fixture = await createVendorFixture(getContainer(), {
            label: "agreement stale",
            status: "invited",
            acceptAgreement: false,
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          const result = await probe(api, headers, "POST", "/vendor/agreement/accept", {
            version: "v0-old",
            accepted: true,
          });

          expect(result.status).toBe(409);
          expect(result.code).toBe("agreement_version_changed");
        });

        it.each([
          ["an extra key", { version: "v1-draft", accepted: true, extra: 1 }],
          ["accepted false", { version: "v1-draft", accepted: false }],
          ["a missing version", { accepted: true }],
        ])("answers 400 for %s", async (_label, body) => {
          const fixture = await createVendorFixture(getContainer(), {
            label: "agreement invalid",
            status: "invited",
            acceptAgreement: false,
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });
          expect(
            (await probe(api, headers, "POST", "/vendor/agreement/accept", body)).status
          ).toBe(400);
        });
      });

      describe("GET /vendor/me/locations", () => {
        it("returns only the caller's locations with the readable state and no internal ids", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "locations own",
            locations: [
              { state_code: "IN-MH", pin: "400001" },
              { state_code: "IN-KA", pin: "560001" },
            ],
          });
          const other = await createVendorFixture(container, {
            label: "locations other",
            locations: [{ state_code: "IN-DL", pin: "110001" }],
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          const result = await probe(api, headers, "GET", "/vendor/me/locations");
          const body = result.body as { locations: Record<string, unknown>[] };

          expect(result.status).toBe(200);
          expect(body.locations.map((location) => location.code)).toEqual(
            fixture.locations.map((location) => location.code).sort()
          );
          expect(body.locations[0].state_name).toBeTruthy();
          for (const location of body.locations) {
            assertOutputWithinAllowlist(location, vendorLocationSerializer.allowedPaths);
            expect(location).not.toHaveProperty("stock_location_id");
            expect(location).not.toHaveProperty("vendor_id");
          }
          const text = JSON.stringify(body);
          expect(text).not.toContain(other.locations[0].code);
          for (const location of fixture.locations) {
            expect(text).not.toContain(location.stock_location_id);
          }
        });

        it("lists an inactive location too, with its status", async () => {
          const fixture = await createVendorFixture(getContainer(), {
            label: "locations inactive",
            locations: [
              { state_code: "IN-MH", pin: "400001" },
              { state_code: "IN-KA", pin: "560001", status: "inactive" },
            ],
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          const body = (await probe(api, headers, "GET", "/vendor/me/locations")).body as {
            locations: { status: string }[];
          };

          expect(body.locations.map((location) => location.status).sort()).toEqual([
            "active",
            "inactive",
          ]);
        });

        it("returns an empty list for a vendor without locations", async () => {
          const fixture = await createVendorFixture(getContainer(), { label: "no locations" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });
          const body = (await probe(api, headers, "GET", "/vendor/me/locations")).body as any;
          expect(body.locations).toEqual([]);
        });
      });

      describe("audit of vendor writes", () => {
        it("records the actor type, the body key names and no body values", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "audit write",
            status: "invited",
            acceptAgreement: false,
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          await probe(api, headers, "POST", "/vendor/agreement/accept", AGREEMENT_BODY);

          const entry = await waitForAuditEntry(
            container,
            (row) =>
              row.action === "vendor.request" &&
              row.actor_type === "vendor" &&
              row.actor_id === fixture.user_id
          );
          expect(entry).not.toBeNull();
          expect(entry!.target_id).toBe(fixture.vendor_id);
          expect(entry!.http_method).toBe("POST");
          expect(entry!.http_status).toBe(200);
          expect((entry!.meta as { body_keys: string[] }).body_keys).toEqual([
            "accepted",
            "version",
          ]);
          expect(JSON.stringify(entry!.meta)).not.toContain("v1-draft");
        });

        it("records a refused write with its refusal code", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "audit denied",
            status: "suspended",
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          await probe(api, headers, "POST", "/vendor/agreement/accept", AGREEMENT_BODY);

          const entry = await waitForAuditEntry(
            container,
            (row) => row.action === "vendor.request" && row.actor_id === fixture.user_id
          );
          expect(entry).not.toBeNull();
          expect(entry!.http_status).toBe(403);
          expect((entry!.meta as { code: string }).code).toBe("vendor_suspended");
        });
      });
    });
  },
});
