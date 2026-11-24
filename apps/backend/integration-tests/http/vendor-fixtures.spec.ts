import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { isAgreementCurrent } from "../../src/lib/vendor/eligibility";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { adminHeadersFor, type StaffRoleKey } from "../helpers/admin-as";
import {
  enrollVendorMfa,
  getVendorSession,
  loginVendorWithMfa,
  MFA_CLAIM,
} from "../helpers/mfa";
import { probe } from "../helpers/staff-users";
import {
  createVendorFixture,
  decodeJwtPayload,
  vendorLogin,
} from "../helpers/vendor-fixtures";

jest.setTimeout(240 * 1000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("vendor fixtures and session helpers", () => {
      it("builds an active vendor with two locations and an accepted agreement", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "active pair",
          locations: [
            { state_code: "IN-MH", pin: "400001" },
            { state_code: "IN-KA", pin: "560001" },
          ],
        });

        const [vendor] = await getVendorModule(container).listVendors(
          { id: fixture.vendor_id },
          { take: 1 }
        );
        expect(vendor.status).toBe("active");
        expect(await isAgreementCurrent(container, fixture.vendor_id)).toBe(true);
        expect(fixture.locations).toHaveLength(2);
        expect(new Set(fixture.locations.map((location) => location.code)).size).toBe(2);
        expect(fixture.locations.every((location) => location.stock_location_id)).toBe(true);
        expect(fixture.accept_url).toBeUndefined();
      });

      it("builds an invited, unregistered vendor and returns its unused link", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "waiting",
          status: "invited",
          registered: false,
        });

        expect(fixture.accept_url).toContain("#token=");
        const vendorModule = getVendorModule(container);
        const invites = await vendorModule.listVendorInvites(
          { vendor_user_id: fixture.user_id },
          { take: null }
        );
        expect(invites).toHaveLength(1);
        expect(invites[0].used_at).toBeNull();
        const [vendor] = await vendorModule.listVendors({ id: fixture.vendor_id }, { take: 1 });
        expect(vendor.status).toBe("invited");
        expect(fixture.registered).toBe(false);
      });

      it("builds a registered vendor without an accepted agreement", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "no agreement",
          status: "invited",
          acceptAgreement: false,
        });

        const invites = await getVendorModule(container).listVendorInvites(
          { vendor_user_id: fixture.user_id },
          { take: null }
        );
        expect(invites.some((invite) => invite.used_at)).toBe(true);
        expect(await isAgreementCurrent(container, fixture.vendor_id)).toBe(false);
      });

      it("builds a registered, suspended vendor", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, {
          label: "stopped",
          status: "suspended",
          locations: [{ state_code: "IN-DL", pin: "110001" }],
        });

        const [vendor] = await getVendorModule(container).listVendors(
          { id: fixture.vendor_id },
          { take: 1 }
        );
        expect(vendor.status).toBe("suspended");
        expect(vendor.suspended_at).not.toBeNull();
      });

      it("uses a unique email per call and a random 20 character password", async () => {
        const container = getContainer();
        const first = await createVendorFixture(container, { label: "same" });
        const second = await createVendorFixture(container, { label: "same" });

        expect(first.email).not.toBe(second.email);
        expect(first.email).toMatch(/^vendor-same-[0-9a-f]{8}@example\.test$/);
        expect(first.password).toHaveLength(20);
        expect(first.password).not.toBe(second.password);
      });

      it("refuses contradictory options", async () => {
        const container = getContainer();
        await expect(
          createVendorFixture(container, { label: "bad", status: "active", registered: false })
        ).rejects.toMatchObject({ type: "invalid_data" });
      });

      it("logs in and returns a token whose claims name the vendor actor and user", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "login" });

        const token = await vendorLogin(api, fixture);
        const claims = decodeJwtPayload(token);

        expect(claims.actor_type).toBe("vendor");
        expect(claims.actor_id).toBe(fixture.user_id);
      });

      it("rejects a wrong password", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "wrong" });
        const result = await probe(api, {}, "POST", "/auth/vendor/emailpass", {
          email: fixture.email,
          password: `${fixture.password}x`,
        });
        expect(result.status).toBe(401);
      });

      it("returns headers of an unenrolled session", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "plain session" });

        const { headers } = await getVendorSession(api, fixture, { enrolled: false });
        const claims = decodeJwtPayload(headers.authorization.replace("Bearer ", ""));

        expect(claims.actor_id).toBe(fixture.user_id);
        expect(claims[MFA_CLAIM] ?? false).toBe(false);
      });

      it("returns headers of an enrolled session for the same user", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "enrolled session" });

        const { headers } = await getVendorSession(api, fixture, { enrolled: true });
        const claims = decodeJwtPayload(headers.authorization.replace("Bearer ", ""));

        expect(claims.actor_id).toBe(fixture.user_id);
        expect(claims.actor_type).toBe("vendor");
        expect(claims[MFA_CLAIM]).toBe(true);
      });

      it("enrols through the real endpoints and returns the secret and recovery codes", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "real enrolment" });
        const token = await vendorLogin(api, fixture);

        const enrolment = await enrollVendorMfa(api, token);

        expect(enrolment.secret).toMatch(/^[A-Z2-7]{16,}$/);
        expect(enrolment.recoveryCodes.length).toBeGreaterThan(0);
      });

      it("follows the recorded challenge path when signing in after enrolment", async () => {
        const container = getContainer();
        const fixture = await createVendorFixture(container, { label: "challenge" });
        const { secret } = await enrollVendorMfa(api, await vendorLogin(api, fixture));

        const token = await loginVendorWithMfa(api, {
          email: fixture.email,
          password: fixture.password,
          secret,
        });

        const claims = decodeJwtPayload(token);
        expect(claims.actor_id).toBe(fixture.user_id);
        expect(claims[MFA_CLAIM]).toBe(true);
      });

      const roles: StaffRoleKey[] = [
        "superadmin",
        "catalog_approver",
        "order_router",
        "support",
        "finance_readonly",
      ];
      it.each(roles)("gives staff headers for the %s role", async (role) => {
        const headers = await adminHeadersFor(api, getContainer(), role);
        expect(headers.authorization).toMatch(/^Bearer .+/);
      });
    });
  },
});
