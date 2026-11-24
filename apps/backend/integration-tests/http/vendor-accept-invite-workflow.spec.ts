jest.mock("../../src/emails/lib/send-email", () => ({
  ...jest.requireActual("../../src/emails/lib/send-email"),
  sendTemplatedEmail: jest.fn(async () => true),
}));

jest.mock("../../src/lib/vendor/auth-identities", () => {
  const actual = jest.requireActual("../../src/lib/vendor/auth-identities");
  return { ...actual, linkVendorActor: jest.fn(actual.linkVendorActor) };
});

import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";
import { linkVendorActor } from "../../src/lib/vendor/auth-identities";
import { generateInviteToken } from "../../src/lib/vendor/invite-token";
import { VENDOR_MODULE } from "../../src/modules/vendor";
import { acceptVendorInviteWorkflow } from "../../src/workflows/vendors/accept-vendor-invite";
import { inviteVendorWorkflow } from "../../src/workflows/vendors/invite-vendor";

jest.setTimeout(120 * 1000);

process.env.VENDOR_PORTAL_URL = "https://backend.example.test/vendor-portal";

const GENERIC_MESSAGE = "This invitation link cannot be used. Ask the store for a new invitation.";
const PASSWORD = "correct horse battery";

const tokenFrom = (url: string) => new URL(url).hash.replace("#token=", "");

const unwrapError = (error: unknown) => {
  const wrapped = error as {
    message?: string;
    code?: string;
    type?: string;
    error?: { message?: string; code?: string; type?: string };
  };
  return {
    message: wrapped.error?.message ?? wrapped.message ?? String(error),
    code: wrapped.error?.code ?? wrapped.code,
    type: wrapped.error?.type ?? wrapped.type,
  };
};

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return unwrapError(error);
  }
  throw new Error("expected the workflow to fail");
};

const authInput = (email: string, password: string) => ({
  url: "",
  headers: {},
  query: {},
  protocol: "",
  body: { email, password },
});

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    const vendorService = () => getContainer().resolve(VENDOR_MODULE) as any;
    const authService = () => getContainer().resolve(Modules.AUTH) as any;

    // An invitation created through the real workflow.
    const invited = async (email: string) => {
      const { result } = await inviteVendorWorkflow(getContainer()).run({
        input: {
          internal_name: "Test Vendor",
          contact_name: "Asha",
          contact_email: email,
          actor: { id: "user_test" },
          include_accept_url: true,
        },
      });
      return { ...result, token: tokenFrom(result.accept_url as string), email };
    };

    // An invitation written straight into the module, for cases the invite workflow refuses.
    const seeded = async (
      options: { email?: string; status?: "invited" | "active" | "suspended"; expiresInMs?: number } = {}
    ) => {
      const { email = "seeded@example.test", status = "invited", expiresInMs = 3_600_000 } = options;
      const vendor = await vendorService().createVendors({
        internal_name: "Seeded Vendor",
        contact_name: "Seeded",
        contact_email: email,
        status,
      });
      const user = await vendorService().createVendorUsers({ vendor_id: vendor.id, email, name: "Seeded" });
      const { token, tokenHash } = generateInviteToken();
      const invite = await vendorService().createVendorInvites({
        vendor_user_id: user.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + expiresInMs),
      });
      return { vendor, user, invite, token, email };
    };

    const accept = (token: string, password = PASSWORD) =>
      acceptVendorInviteWorkflow(getContainer()).run({ input: { token, password } });

    const identitiesFor = async (email: string) =>
      authService().listProviderIdentities({ entity_id: email });

    describe("accept vendor invite workflow", () => {
      it("creates one identity linked as the vendor actor and marks the invite used", async () => {
        const first = await invited("accept-ok@example.test");
        const { result } = await accept(first.token);
        expect(result.vendor_user_id).toBe(first.user_id);

        const identities = await identitiesFor(first.email);
        expect(identities).toHaveLength(1);

        const login = await authService().authenticate("emailpass", authInput(first.email, PASSWORD));
        expect(login.success).toBe(true);
        expect(login.authIdentity.app_metadata.vendor_id).toBe(first.user_id);

        const [invite] = await vendorService().listVendorInvites({ id: first.invite_id });
        expect(invite.used_at).not.toBeNull();
      });

      it("leaves the vendor in the invited state", async () => {
        const first = await invited("still-invited@example.test");
        await accept(first.token);
        const [vendor] = await vendorService().listVendors({ id: first.vendor_id });
        expect(vendor.status).toBe("invited");
      });

      it("refuses a second use of the same token with the generic answer", async () => {
        const first = await invited("reuse@example.test");
        await accept(first.token);
        const error = await failure(() => accept(first.token));
        expect(error.code).toBe("invalid_invite");
        expect(error.message).toBe(GENERIC_MESSAGE);
      });

      it("gives the identical answer for unknown, expired and suspended cases", async () => {
        const unknown = await failure(() => accept(generateInviteToken().token));
        const expired = await seeded({ email: "expired@example.test", expiresInMs: -3_600_000 });
        const expiredError = await failure(() => accept(expired.token));
        const suspended = await seeded({ email: "suspended@example.test", status: "suspended" });
        const suspendedError = await failure(() => accept(suspended.token));
        const garbage = await failure(() => accept("x".repeat(500)));

        for (const error of [unknown, expiredError, suspendedError, garbage]) {
          expect(error.code).toBe("invalid_invite");
          expect(error.message).toBe(GENERIC_MESSAGE);
        }
      });

      it("lets exactly one of two simultaneous accepts win", async () => {
        const first = await invited("race@example.test");
        const outcomes = await Promise.allSettled([
          accept(first.token, "winner password one"),
          accept(first.token, "winner password two"),
        ]);
        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
        expect(unwrapError(rejected.reason).code).toBe("invalid_invite");

        const winner = outcomes[0].status === "fulfilled" ? "winner password one" : "winner password two";
        const loser = winner === "winner password one" ? "winner password two" : "winner password one";
        expect(
          (await authService().authenticate("emailpass", authInput(first.email, winner))).success
        ).toBe(true);
        expect(
          (await authService().authenticate("emailpass", authInput(first.email, loser))).success
        ).toBe(false);
        expect(await identitiesFor(first.email)).toHaveLength(1);
      });

      it("refuses when a customer identity already uses the address and releases the invite", async () => {
        const seed = await seeded({ email: "shared@example.test" });
        await authService().createAuthIdentities({
          provider_identities: [{ provider: "emailpass", entity_id: seed.email }],
          app_metadata: { customer_id: "cus_test" },
        });

        const error = await failure(() => accept(seed.token));
        expect(error.code).toBe("invalid_invite");
        expect(error.message).toBe(GENERIC_MESSAGE);

        const [invite] = await vendorService().listVendorInvites({ id: seed.invite.id });
        expect(invite.used_at).toBeNull();
        expect(await identitiesFor(seed.email)).toHaveLength(1);
      });

      it.each([11, 129])("refuses a password of %i characters before the token is used", async (length) => {
        const first = await invited(`pw-${length}@example.test`);
        const error = await failure(() => accept(first.token, "p".repeat(length)));
        expect(error.code).toBe("invalid_password");
        expect(error.message).toBe("Password must be 12 to 128 characters.");

        const [invite] = await vendorService().listVendorInvites({ id: first.invite_id });
        expect(invite.used_at).toBeNull();
        expect(await identitiesFor(first.email)).toHaveLength(0);
      });

      it("accepts a password at both length limits", async () => {
        const low = await invited("low@example.test");
        await accept(low.token, "p".repeat(12));
        const high = await invited("high@example.test");
        await accept(high.token, "p".repeat(128));
        expect(await identitiesFor("low@example.test")).toHaveLength(1);
        expect(await identitiesFor("high@example.test")).toHaveLength(1);
      });

      it("deletes the identity and releases the invite when the actor link fails", async () => {
        const first = await invited("link-fail@example.test");
        (linkVendorActor as jest.Mock).mockRejectedValueOnce(new Error("link failed"));

        await failure(() => accept(first.token));

        expect(await identitiesFor(first.email)).toHaveLength(0);
        const [invite] = await vendorService().listVendorInvites({ id: first.invite_id });
        expect(invite.used_at).toBeNull();

        // The same link works afterwards.
        const { result } = await accept(first.token);
        expect(result.vendor_user_id).toBe(first.user_id);
      });
    });
  },
});
