import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";
import { randomBytes } from "node:crypto";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { probe } from "../helpers/staff-users";
import { createVendorFixture, vendorLogin } from "../helpers/vendor-fixtures";

jest.setTimeout(300 * 1000);

const GOOD_PASSWORD = "Spec-Strong-Password-1";

const tokenOf = (acceptUrl: string): string =>
  new URLSearchParams(new URL(acceptUrl).hash.slice(1)).get("token") as string;

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("POST /vendor/accept-invite", () => {
      const waitingVendor = (label: string) =>
        createVendorFixture(getContainer(), { label, status: "invited", registered: false });

      it("registers with a live token and the new credentials sign in", async () => {
        const fixture = await waitingVendor("accept ok");

        const result = await probe(api, {}, "POST", "/vendor/accept-invite", {
          token: tokenOf(fixture.accept_url!),
          password: GOOD_PASSWORD,
        });

        expect(result.status).toBe(200);
        expect(result.body).toEqual({ ok: true });
        const token = await vendorLogin(api, { email: fixture.email, password: GOOD_PASSWORD });
        expect(token.split(".")).toHaveLength(3);
        const [vendor] = await getVendorModule(getContainer()).listVendors(
          { id: fixture.vendor_id },
          { take: 1 }
        );
        expect(vendor.status).toBe("invited");
      });

      it("refuses a replayed, an unknown and an expired token with identical bodies", async () => {
        const container = getContainer();
        const used = await waitingVendor("accept replay");
        const token = tokenOf(used.accept_url!);
        await probe(api, {}, "POST", "/vendor/accept-invite", { token, password: GOOD_PASSWORD });

        const replay = await probe(api, {}, "POST", "/vendor/accept-invite", {
          token,
          password: GOOD_PASSWORD,
        });

        const unknown = await probe(api, {}, "POST", "/vendor/accept-invite", {
          token: randomBytes(32).toString("base64url"),
          password: GOOD_PASSWORD,
        });

        const expired = await waitingVendor("accept expired");
        const vendorModule = getVendorModule(container);
        const [invite] = await vendorModule.listVendorInvites(
          { vendor_user_id: expired.user_id },
          { take: 1 }
        );
        await vendorModule.updateVendorInvites([
          { id: invite.id, expires_at: new Date(Date.now() - 1000) },
        ] as never);
        const lapsed = await probe(api, {}, "POST", "/vendor/accept-invite", {
          token: tokenOf(expired.accept_url!),
          password: GOOD_PASSWORD,
        });

        for (const result of [replay, unknown, lapsed]) {
          expect(result.status).toBe(400);
          expect(result.code).toBe("invalid_invite");
        }
        expect(unknown.body).toEqual(replay.body);
        expect(lapsed.body).toEqual(replay.body);
      });

      it.each([
        ["an extra key", (token: string) => ({ token, password: GOOD_PASSWORD, email: "x@example.test" })],
        ["a missing token", () => ({ password: GOOD_PASSWORD })],
        ["an 11 character password", (token: string) => ({ token, password: "elevenchars" })],
        ["a 129 character password", (token: string) => ({ token, password: "p".repeat(129) })],
      ])("answers 400 for %s and leaves the invitation usable", async (_label, makeBody) => {
        const fixture = await waitingVendor("accept invalid");
        const token = tokenOf(fixture.accept_url!);

        const result = await probe(api, {}, "POST", "/vendor/accept-invite", makeBody(token));
        expect(result.status).toBe(400);

        const retry = await probe(api, {}, "POST", "/vendor/accept-invite", {
          token,
          password: GOOD_PASSWORD,
        });
        expect(retry.status).toBe(200);
      });

      it("answers 404 to the stock register route and creates no identity", async () => {
        const email = `blocked-${randomBytes(4).toString("hex")}@example.test`;

        const result = await probe(api, {}, "POST", "/auth/vendor/emailpass/register", {
          email,
          password: GOOD_PASSWORD,
        });

        expect(result.status).toBe(404);
        const auth = getContainer().resolve(Modules.AUTH) as {
          listAuthIdentities(filter: Record<string, unknown>): Promise<unknown[]>;
        };
        expect(
          await auth.listAuthIdentities({
            provider_identities: { provider: "emailpass", entity_id: [email] },
          })
        ).toHaveLength(0);
      });

      it("keeps vendor sign-in working while registration is blocked", async () => {
        const fixture = await createVendorFixture(getContainer(), { label: "login still works" });
        const result = await probe(api, {}, "POST", "/auth/vendor/emailpass", {
          email: fixture.email,
          password: fixture.password,
        });
        expect(result.status).toBe(200);
        expect((result.body as { token?: string }).token).toBeTruthy();
      });

      it("serves no other method on the route", async () => {
        const result = await probe(api, {}, "GET", "/vendor/accept-invite");
        expect(result.status).toBe(404);
      });
    });
  },
});
