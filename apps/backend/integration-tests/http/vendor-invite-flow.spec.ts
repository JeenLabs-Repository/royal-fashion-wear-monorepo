jest.mock("../../src/emails/lib/send-email", () => ({
  ...jest.requireActual("../../src/emails/lib/send-email"),
  sendTemplatedEmail: jest.fn(async () => true),
}));

jest.mock("../../src/lib/settings/vendor-onboarding", () => {
  const actual = jest.requireActual("../../src/lib/settings/vendor-onboarding");
  return { ...actual, getVendorOnboardingSettings: jest.fn(actual.getVendorOnboardingSettings) };
});

jest.mock("../../src/lib/audit", () => {
  const actual = jest.requireActual("../../src/lib/audit");
  return { ...actual, recordAudit: jest.fn(actual.recordAudit) };
});

import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";
import { createHash } from "node:crypto";
import { sendTemplatedEmail } from "../../src/emails/lib/send-email";
import { recordAudit } from "../../src/lib/audit";
import { getVendorOnboardingSettings } from "../../src/lib/settings/vendor-onboarding";
import { VENDOR_MODULE } from "../../src/modules/vendor";
import { AUDIT_LOG_MODULE } from "../../src/modules/audit-log/constants";
import { inviteVendorWorkflow } from "../../src/workflows/vendors/invite-vendor";
import { resendVendorInviteWorkflow } from "../../src/workflows/vendors/resend-vendor-invite";

jest.setTimeout(120 * 1000);

process.env.VENDOR_PORTAL_URL = "https://backend.example.test/vendor-portal";

const input = (overrides: Record<string, unknown> = {}) => ({
  internal_name: "Test Vendor",
  contact_name: "Asha",
  contact_email: "asha@example.test",
  actor: { id: "user_test", label: "owner@example.test" },
  ...overrides,
});

const tokenFrom = (url: string) => new URL(url).hash.replace("#token=", "");

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
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
  }
  throw new Error("expected the workflow to fail");
};

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    const vendorService = () => getContainer().resolve(VENDOR_MODULE) as any;

    describe("invite vendor workflow", () => {
      it("creates a vendor, a user and a single-use invite and writes one audit entry", async () => {
        const { result } = await inviteVendorWorkflow(getContainer()).run({ input: input() });

        for (const key of ["email_sent", "expires_at", "invite_id", "user_id", "vendor_id"]) {
          expect(result).toHaveProperty(key);
        }
        expect(result.accept_url).toBeUndefined();
        expect(result.email_sent).toBe(true);

        const [vendor] = await vendorService().listVendors({ id: result.vendor_id });
        expect(vendor.status).toBe("invited");
        expect(vendor.internal_name).toBe("Test Vendor");

        const [invite] = await vendorService().listVendorInvites({ id: result.invite_id });
        expect(invite.token_hash).toMatch(/^[0-9a-f]{64}$/);
        const hoursAhead = (new Date(invite.expires_at).getTime() - Date.now()) / 3_600_000;
        expect(hoursAhead).toBeGreaterThan(71.9);
        expect(hoursAhead).toBeLessThan(72.1);

        const audit = getContainer().resolve(AUDIT_LOG_MODULE) as any;
        const entries = await audit.listAuditEntries({
          action: "vendor.invited",
          target_id: result.vendor_id,
        });
        expect(entries).toHaveLength(1);
        expect(entries[0].target_id).toBe(result.vendor_id);
      });

      it("uses the expiry the settings reader returns at the time of the invite", async () => {
        (getVendorOnboardingSettings as jest.Mock).mockResolvedValueOnce({
          invite_expiry_hours: 24,
          current_agreement_version: "v1-draft",
        });
        const { result } = await inviteVendorWorkflow(getContainer()).run({
          input: input({ contact_email: "expiry24@example.test" }),
        });
        const hoursAhead = (new Date(result.expires_at).getTime() - Date.now()) / 3_600_000;
        expect(hoursAhead).toBeGreaterThan(23.9);
        expect(hoursAhead).toBeLessThan(24.1);
      });

      it("hands the raw token to the email only, and to the caller only on request", async () => {
        const without = await inviteVendorWorkflow(getContainer()).run({
          input: input({ contact_email: "quiet@example.test" }),
        });
        expect(JSON.stringify(without.result)).not.toContain("token=");

        const withUrl = await inviteVendorWorkflow(getContainer()).run({
          input: input({ contact_email: "loud@example.test", include_accept_url: true }),
        });
        const token = tokenFrom(withUrl.result.accept_url as string);
        const [invite] = await vendorService().listVendorInvites({ id: withUrl.result.invite_id });
        expect(invite.token_hash).not.toBe(token);
        expect(invite.token_hash).toBe(createHash("sha256").update(token).digest("hex"));

        const calls = (sendTemplatedEmail as jest.Mock).mock.calls.map((call) => call[0]);
        const last = calls[calls.length - 1];
        expect(last.template).toBe("vendor-invite");
        expect(last.props.accept_url).toContain("/accept-invite#token=");
        expect(last.idempotencyKey).toMatch(/^vendor-invite:vinv_[^:]+:send$/);
      });

      it("stores the contact email in lower case", async () => {
        const { result } = await inviteVendorWorkflow(getContainer()).run({
          input: input({ contact_email: "Mixed.Case@Example.Test" }),
        });
        const [user] = await vendorService().listVendorUsers({ id: result.user_id });
        expect(user.email).toBe("mixed.case@example.test");
      });

      it("refuses an email that already has a vendor user and creates nothing more", async () => {
        await inviteVendorWorkflow(getContainer()).run({
          input: input({ contact_email: "dup-vendor@example.test" }),
        });
        const beforeVendors = await vendorService().listVendors();
        const beforeUsers = await vendorService().listVendorUsers();
        const beforeInvites = await vendorService().listVendorInvites();
        const error = await failure(() =>
          inviteVendorWorkflow(getContainer()).run({
            input: input({
              internal_name: "Second",
              contact_email: "dup-vendor@example.test",
            }),
          })
        );
        expect(error.message).toContain("already exists");
        expect(await vendorService().listVendors()).toHaveLength(beforeVendors.length);
        expect(await vendorService().listVendorUsers()).toHaveLength(beforeUsers.length);
        expect(await vendorService().listVendorInvites()).toHaveLength(beforeInvites.length);
      });

      it("refuses an email that already has a customer identity and creates nothing", async () => {
        const auth = getContainer().resolve(Modules.AUTH) as any;
        await auth.createAuthIdentities({
          provider_identities: [{ provider: "emailpass", entity_id: "taken@example.test" }],
          app_metadata: { customer_id: "cus_test" },
        });
        const beforeVendors = (await vendorService().listVendors()).length;
        const beforeUsers = (await vendorService().listVendorUsers()).length;
        const beforeInvites = (await vendorService().listVendorInvites()).length;
        const error = await failure(() =>
          inviteVendorWorkflow(getContainer()).run({
            input: input({ contact_email: "taken@example.test" }),
          })
        );
        expect(error.message).toContain("customer, staff or vendor");
        expect(await vendorService().listVendors()).toHaveLength(beforeVendors);
        expect(await vendorService().listVendorUsers()).toHaveLength(beforeUsers);
        expect(await vendorService().listVendorInvites()).toHaveLength(beforeInvites);
      });

      it("removes the vendor, user and invite when a later step fails", async () => {
        (recordAudit as jest.Mock).mockRejectedValueOnce(new Error("audit store unavailable"));
        const beforeVendors = (await vendorService().listVendors()).length;
        const beforeUsers = (await vendorService().listVendorUsers()).length;
        const beforeInvites = (await vendorService().listVendorInvites()).length;
        await failure(() =>
          inviteVendorWorkflow(getContainer()).run({
            input: input({ contact_email: "rollback@example.test" }),
          })
        );
        expect(await vendorService().listVendors()).toHaveLength(beforeVendors);
        expect(await vendorService().listVendorUsers()).toHaveLength(beforeUsers);
        expect(await vendorService().listVendorInvites()).toHaveLength(beforeInvites);
      });
    });

    describe("resend vendor invite workflow", () => {
      const invited = async (email: string) => {
        const { result } = await inviteVendorWorkflow(getContainer()).run({
          input: input({ contact_email: email, include_accept_url: true }),
        });
        return result;
      };

      it("retires every earlier invite, issues a new one and sends a new email", async () => {
        const first = await invited("resend@example.test");
        const callsBefore = (sendTemplatedEmail as jest.Mock).mock.calls.length;

        const { result } = await resendVendorInviteWorkflow(getContainer()).run({
          input: { vendor_id: first.vendor_id, actor: { id: "user_test" }, include_accept_url: true },
        });

        expect(result.invite_id).not.toBe(first.invite_id);
        expect(tokenFrom(result.accept_url as string)).not.toBe(tokenFrom(first.accept_url as string));
        expect((sendTemplatedEmail as jest.Mock).mock.calls.length).toBe(callsBefore + 1);

        const [oldInvite] = await vendorService().listVendorInvites({ id: first.invite_id });
        expect(new Date(oldInvite.expires_at).getTime()).toBeLessThanOrEqual(Date.now());
        expect(oldInvite.used_at).toBeNull();

        const stale = await vendorService().consumeInviteToken(
          createHash("sha256").update(tokenFrom(first.accept_url as string)).digest("hex")
        );
        expect(stale).toBeNull();

        const audit = getContainer().resolve(AUDIT_LOG_MODULE) as any;
        const entries = await audit.listAuditEntries({
          action: "vendor.invited",
          target_id: first.vendor_id,
        });
        expect(entries.some((entry: any) => entry.meta?.resend === true)).toBe(true);
      });

      it("refuses an active vendor", async () => {
        const first = await invited("active-resend@example.test");
        await vendorService().updateVendors({ id: first.vendor_id, status: "active" });
        const error = await failure(() =>
          resendVendorInviteWorkflow(getContainer()).run({
            input: { vendor_id: first.vendor_id, actor: { id: "user_test" } },
          })
        );
        expect(error.message).toBe("This vendor has already registered.");
      });

      it("refuses a vendor whose invite was already used", async () => {
        const first = await invited("used-resend@example.test");
        await vendorService().updateVendorInvites({ id: first.invite_id, used_at: new Date() });
        const error = await failure(() =>
          resendVendorInviteWorkflow(getContainer()).run({
            input: { vendor_id: first.vendor_id, actor: { id: "user_test" } },
          })
        );
        expect(error.message).toBe("This vendor has already registered.");
      });
    });
  },
});
