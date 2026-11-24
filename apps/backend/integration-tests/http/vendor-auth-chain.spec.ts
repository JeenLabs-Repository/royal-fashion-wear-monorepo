import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { randomBytes } from "node:crypto";
import { generatePassword } from "../../src/lib/staff-cli/password";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { suspendVendorWorkflow } from "../../src/workflows/vendors/suspend-vendor";
import { adminHeadersFor } from "../helpers/admin-as";
import { getVendorSession, type VendorCredentials } from "../helpers/mfa";
import { signToken } from "../helpers/create-admin-user";
import { probe } from "../helpers/staff-users";
import { createVendorFixture, type VendorFixture } from "../helpers/vendor-fixtures";

jest.setTimeout(300 * 1000);

const AGREEMENT_BODY = { version: "v1-draft", accepted: true };
const ONBOARDING_GETS = [
  "/vendor/me",
  "/vendor/onboarding",
  "/vendor/agreement/current",
  "/vendor/me/locations",
];

/** A second user of an existing vendor, with a real sign-in identity. */
async function addSecondUser(
  container: MedusaContainer,
  fixture: VendorFixture
): Promise<VendorCredentials & { user_id: string }> {
  const email = `second-${randomBytes(4).toString("hex")}@example.test`;
  const password = generatePassword(20);
  const [user] = await getVendorModule(container).createVendorUsers([
    { vendor_id: fixture.vendor_id, email, name: "Second User" },
  ]);
  const auth = container.resolve(Modules.AUTH) as {
    register(provider: string, data: unknown): Promise<{ success: boolean; authIdentity?: { id: string } }>;
    updateAuthIdentities(data: Record<string, unknown>): Promise<unknown>;
  };
  const registered = (await auth.register("emailpass", { body: { email, password } } as never)) as {
    success: boolean;
    authIdentity?: { id: string };
  };
  await auth.updateAuthIdentities({
    id: registered.authIdentity!.id,
    app_metadata: { vendor_id: user.id },
  });
  return { email, password, token_secret: fixture.token_secret, user_id: user.id };
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("vendor request chain", () => {
      describe("authentication and actor types", () => {
        it("answers 401 without a sign-in, also for a route that does not exist", async () => {
          expect((await probe(api, {}, "GET", "/vendor/me")).status).toBe(401);
          expect((await probe(api, {}, "GET", "/vendor/does-not-exist")).status).toBe(401);
          expect(
            (await probe(api, {}, "POST", "/vendor/agreement/accept", AGREEMENT_BODY)).status
          ).toBe(401);
        });

        it("answers 404 for a missing route once an enrolled active vendor is signed in", async () => {
          const fixture = await createVendorFixture(getContainer(), { label: "missing route" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });
          expect((await probe(api, headers, "GET", "/vendor/does-not-exist")).status).toBe(404);
        });

        it("refuses a vendor token on the admin API", async () => {
          const fixture = await createVendorFixture(getContainer(), { label: "vendor on admin" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });
          expect((await probe(api, headers, "GET", "/admin/users/me")).status).toBe(401);
          expect((await probe(api, headers, "GET", "/admin/products")).status).toBe(401);
        });

        it("refuses an admin session on the vendor API", async () => {
          const headers = await adminHeadersFor(api, getContainer(), "superadmin");
          expect((await probe(api, headers, "GET", "/vendor/me")).status).toBe(401);
        });

        it("refuses a customer token on the vendor API", async () => {
          const fixture = await createVendorFixture(getContainer(), { label: "customer token" });
          const token = signToken(
            {
              actor_id: "cus_spec",
              actor_type: "customer",
              auth_identity_id: "authid_spec",
              app_metadata: { customer_id: "cus_spec" },
            },
            fixture.token_secret
          );
          const result = await probe(api, { authorization: `Bearer ${token}` }, "GET", "/vendor/me");
          expect(result.status).toBe(401);
        });
      });

      describe("two-step sign-in gate", () => {
        it("blocks an unenrolled vendor outside the two allowed reads", async () => {
          const fixture = await createVendorFixture(getContainer(), { label: "unenrolled gate" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: false });

          for (const path of ["/vendor/agreement/current", "/vendor/me/locations"]) {
            const result = await probe(api, headers, "GET", path);
            expect({ path, status: result.status, code: result.code }).toEqual({
              path,
              status: 403,
              code: "mfa_enrollment_required",
            });
          }
        });

        it("blocks an unenrolled vendor from writing and stores nothing", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "unenrolled write",
            status: "invited",
            acceptAgreement: false,
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: false });

          const result = await probe(api, headers, "POST", "/vendor/agreement/accept", AGREEMENT_BODY);

          expect(result.status).toBe(403);
          expect(result.code).toBe("mfa_enrollment_required");
          expect(
            await getVendorModule(container).listVendorAgreementAcceptances(
              { vendor_user_id: fixture.user_id },
              { take: null }
            )
          ).toHaveLength(0);
        });

        it("lets an unenrolled vendor read who it is and what is left to do", async () => {
          const fixture = await createVendorFixture(getContainer(), { label: "unenrolled reads" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: false });

          const me = await probe(api, headers, "GET", "/vendor/me");
          expect(me.status).toBe(200);
          expect((me.body as { mfa_enabled: boolean }).mfa_enabled).toBe(false);
          expect((await probe(api, headers, "GET", "/vendor/onboarding")).status).toBe(200);
        });
      });

      describe("vendor status", () => {
        it("lets an invited vendor call the five onboarding routes only", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "invited onboarding",
            status: "invited",
            acceptAgreement: false,
            locations: [{ state_code: "IN-MH", pin: "400001" }],
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          for (const path of ONBOARDING_GETS) {
            expect({ path, status: (await probe(api, headers, "GET", path)).status }).toEqual({
              path,
              status: 200,
            });
          }
          expect(
            (await probe(api, headers, "POST", "/vendor/agreement/accept", AGREEMENT_BODY)).status
          ).toBe(200);

          for (const [method, body] of [
            ["GET", undefined],
            ["POST", {}],
          ] as const) {
            const denied = await probe(api, headers, method, "/vendor/products", body);
            expect({ method, status: denied.status, code: denied.code }).toEqual({
              method,
              status: 403,
              code: "vendor_not_active",
            });
          }
        });

        it("refuses a suspended vendor on every route, including its own profile", async () => {
          const fixture = await createVendorFixture(getContainer(), {
            label: "suspended vendor",
            status: "suspended",
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          for (const path of [...ONBOARDING_GETS, "/vendor/products"]) {
            const result = await probe(api, headers, "GET", path);
            expect({ path, status: result.status, code: result.code }).toEqual({
              path,
              status: 403,
              code: "vendor_suspended",
            });
          }
        });

        it("refuses a write by a suspended vendor and stores nothing", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "suspended write",
            status: "suspended",
          });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });
          const before = await getVendorModule(container).listVendorAgreementAcceptances(
            { vendor_user_id: fixture.user_id },
            { take: null }
          );

          const result = await probe(api, headers, "POST", "/vendor/agreement/accept", {
            version: "v1-draft",
            accepted: true,
          });

          expect(result.status).toBe(403);
          expect(result.code).toBe("vendor_suspended");
          expect(
            await getVendorModule(container).listVendorAgreementAcceptances(
              { vendor_user_id: fixture.user_id },
              { take: null }
            )
          ).toHaveLength(before.length);
        });

        it("rejects a token issued while active on the very next request after suspension", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "next request" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });
          expect((await probe(api, headers, "GET", "/vendor/me")).status).toBe(200);

          await suspendVendorWorkflow(container).run({
            input: {
              vendor_id: fixture.vendor_id,
              reason: "Suspended during the chain spec",
              actor: { id: "user_chain_spec" },
            },
          });

          const after = await probe(api, headers, "GET", "/vendor/me");
          expect(after.status).toBe(403);
          expect(after.code).toBe("vendor_suspended");
        });
      });

      describe("strict input", () => {
        it("answers 400 for any query key, including a vendor id of another vendor", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "query keys" });
          const other = await createVendorFixture(container, { label: "other vendor" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          expect(
            (await probe(api, headers, "GET", `/vendor/me?vendor_id=${other.vendor_id}`)).status
          ).toBe(400);
          expect((await probe(api, headers, "GET", "/vendor/me/locations?limit=1")).status).toBe(
            400
          );
          expect((await probe(api, headers, "GET", "/vendor/me")).status).toBe(200);
        });

        it("answers 400 for a vendor id or any unknown key in a body", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, { label: "body keys" });
          const { headers } = await getVendorSession(api, fixture, { enrolled: true });

          const result = await probe(api, headers, "POST", "/vendor/agreement/accept", {
            ...AGREEMENT_BODY,
            vendor_id: "vnd_other",
          });
          expect(result.status).toBe(400);
        });
      });

      describe("vendor identity", () => {
        it("derives the vendor from the actor, so two users of one vendor see the same data", async () => {
          const container = getContainer();
          const fixture = await createVendorFixture(container, {
            label: "two users",
            locations: [
              { state_code: "IN-MH", pin: "400001" },
              { state_code: "IN-KA", pin: "560001" },
            ],
          });
          const second = await addSecondUser(container, fixture);

          const first = await getVendorSession(api, fixture, { enrolled: true });
          const secondSession = await getVendorSession(api, second, { enrolled: true });

          const meFirst = (await probe(api, first.headers, "GET", "/vendor/me")).body as any;
          const meSecond = (await probe(api, secondSession.headers, "GET", "/vendor/me")).body as any;
          expect(meFirst.vendor.id).toBe(meSecond.vendor.id);
          expect(meFirst.user.id).toBe(fixture.user_id);
          expect(meSecond.user.id).toBe(second.user_id);
          expect(meFirst.user.id).not.toBe(meFirst.vendor.id);
          expect(meSecond.user.id).not.toBe(meSecond.vendor.id);

          const codesOf = async (headers: Record<string, string>) =>
            (
              (await probe(api, headers, "GET", "/vendor/me/locations")).body as {
                locations: { code: string }[];
              }
            ).locations
              .map((location) => location.code)
              .sort();
          expect(await codesOf(first.headers)).toEqual(await codesOf(secondSession.headers));
          expect(await codesOf(first.headers)).toHaveLength(2);
        });

        it("shows another vendor's user none of the first vendor's data", async () => {
          const container = getContainer();
          const owner = await createVendorFixture(container, {
            label: "owner",
            locations: [{ state_code: "IN-MH", pin: "400001" }],
          });
          const stranger = await createVendorFixture(container, { label: "stranger" });

          const session = await getVendorSession(api, stranger, { enrolled: true });
          const locations = (await probe(api, session.headers, "GET", "/vendor/me/locations"))
            .body as { locations: { code: string }[] };

          expect(locations.locations).toEqual([]);
          expect(JSON.stringify(locations)).not.toContain(owner.locations[0].code);
        });
      });
    });
  },
});
