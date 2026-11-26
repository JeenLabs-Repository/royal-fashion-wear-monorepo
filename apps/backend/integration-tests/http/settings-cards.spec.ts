import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  DEFAULT_INSTANCE_ID,
  integrationProviderKey,
} from "@gorgo/medusa-integration";
import { getSmtpSettings } from "../../src/lib/settings/smtp";
import { INTEGRATION_MODULE_KEY } from "../../src/lib/settings/resolve-options";
import { getVendorOnboardingSettings } from "../../src/lib/settings/vendor-onboarding";
import { inviteVendorWorkflow } from "../../src/workflows/vendors/invite-vendor";
import { createActor, staffHeaders } from "../helpers/staff-users";

jest.setTimeout(180_000);

const REGISTRY = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../config/plugin-registry.json"), "utf8")
) as { repos: Record<string, { package: string }> };

const RAZORPAY_PACKAGE = REGISTRY.repos["medusa-payment-razorpay"].package;

const IDS = {
  razorpay: "integration-razorpay",
  gst: "integration-gst-invoicing",
  smtp: "integration-smtp",
  vendor: "integration-vendor-onboarding",
} as const;

const ROUTES = {
  list: "/admin/integrations",
  card: (providerId: string) => `/admin/integrations/${providerId}`,
  changes: "/admin/integrations/changes",
};

const SHAPE = {
  saveBody: (values: Record<string, unknown>) => ({ values }),
  listEntries: (data: { integrations?: unknown[] }): Array<Record<string, unknown>> =>
    (data.integrations ?? []) as Array<Record<string, unknown>>,
  entryIdentifier: (entry: Record<string, unknown>): string =>
    String(entry.identifier ?? entry.id ?? ""),
  entryComplete: (entry: Record<string, unknown>): boolean =>
    Boolean(entry.is_complete ?? entry.complete),
  entryProviderId: (entry: Record<string, unknown>): string =>
    String(entry.provider_id ?? ""),
};

function providerId(identifier: string): string {
  return integrationProviderKey(identifier, DEFAULT_INSTANCE_ID);
}

function randomSecret(): string {
  return `s_${randomBytes(18).toString("hex")}`;
}

function razorpayValues(overrides: Record<string, unknown> = {}) {
  return {
    key_id: "rzp_test_demo1234567890",
    key_secret: randomSecret(),
    webhook_secret: randomSecret(),
    merchant_display_name: "Demo Store",
    ...overrides,
  };
}

const GST_VALID = {
  legal_name: "Demo Trading Private Limited",
  gstin: "27AAPFU0939F1ZV",
  registered_state: "IN-MH",
  address_line_1: "1 Demo Street",
  pin: "400001",
};

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let admin: { headers: Record<string, string> };

    async function attempt(
      method: "get" | "post" | "delete",
      url: string,
      body?: unknown
    ): Promise<{ status: number; data: Record<string, unknown> }> {
      try {
        const res =
          method === "get"
            ? await api.get(url, admin)
            : method === "delete"
              ? await api.delete(url, admin)
              : await api.post(url, body, admin);
        return { status: res.status, data: res.data as Record<string, unknown> };
      } catch (error: unknown) {
        const response = (error as { response?: { status: number; data: unknown } })
          .response;
        if (!response) {
          throw error;
        }
        return {
          status: response.status,
          data: (response.data ?? {}) as Record<string, unknown>,
        };
      }
    }

    const save = (identifier: string, values: Record<string, unknown>) =>
      attempt("post", ROUTES.card(providerId(identifier)), SHAPE.saveBody(values));

    function clearOptionsCache(): void {
      const service = getContainer().resolve(INTEGRATION_MODULE_KEY) as {
        clearOptionsCache: (providerId?: string) => void;
      };
      service.clearOptionsCache();
    }

    async function changeHistoryText(): Promise<string> {
      const service = getContainer().resolve(INTEGRATION_MODULE_KEY) as {
        listIntegrationChanges: (
          filter?: Record<string, unknown>,
          config?: Record<string, unknown>
        ) => Promise<unknown>;
      };
      const rows = await service.listIntegrationChanges(
        { provider_id: providerId(IDS.razorpay) },
        { take: 100 }
      );
      const viaHttp = await attempt(
        "get",
        `${ROUTES.changes}?provider_id=${encodeURIComponent(providerId(IDS.razorpay))}&limit=100`
      );
      return `${JSON.stringify(rows)}\n${JSON.stringify(viaHttp.data)}`;
    }

    async function razorpayKeySecret(): Promise<string | undefined> {
      clearOptionsCache();
      const mod = (await import(`${RAZORPAY_PACKAGE}/public`)) as {
        readRazorpayCredentials: (container: unknown) => Promise<{
          status: string;
          credentials?: { key_secret?: string };
        }>;
      };
      const result = await mod.readRazorpayCredentials(getContainer());
      if (result.status !== "configured") {
        return undefined;
      }
      return result.credentials?.key_secret;
    }

    beforeEach(async () => {
      const staff = await createActor(getContainer(), "superadmin");
      admin = { headers: await staffHeaders(api, staff) };
    });

    describe("catalog", () => {
      it("lists the four settings cards", async () => {
        const res = await attempt("get", ROUTES.list);
        expect(res.status).toBe(200);
        const ids = SHAPE.listEntries(res.data as { integrations?: unknown[] }).map(
          SHAPE.entryIdentifier
        );
        for (const id of Object.values(IDS)) {
          expect(ids).toContain(id);
        }
      });

      it("keeps the cards to superadmin staff", async () => {
        const approver = await createActor(getContainer(), "catalog_approver");
        const headers = await staffHeaders(api, approver);
        const res = await api
          .get(ROUTES.list, { headers })
          .catch((error: { response?: { status: number } }) => error.response);
        expect(res?.status).toBe(403);
      });
    });

    describe("razorpay card", () => {
      it("saves fake test values", async () => {
        const res = await save(IDS.razorpay, razorpayValues());
        expect(res.status).toBe(200);
      });

      it("masks key_secret and webhook_secret on read", async () => {
        const values = razorpayValues();
        await save(IDS.razorpay, values);
        const res = await attempt("get", ROUTES.card(providerId(IDS.razorpay)));
        expect(res.status).toBe(200);
        const text = JSON.stringify(res.data);
        expect(text).not.toContain(values.key_secret);
        expect(text).not.toContain(values.webhook_secret);
        expect(text).toContain("rzp_test_demo1234567890");
      });

      it("refuses an empty key_secret", async () => {
        // Clear any prior save so a blank secret is not treated as "keep existing".
        await attempt("delete", ROUTES.card(providerId(IDS.razorpay)));
        const res = await save(IDS.razorpay, razorpayValues({ key_secret: "" }));
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });

      it("refuses a key_id without the test or live prefix", async () => {
        const res = await save(IDS.razorpay, razorpayValues({ key_id: "demo_1234567890" }));
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });

      it("no secret in change history", async () => {
        const first = razorpayValues();
        const second = razorpayValues();
        await save(IDS.razorpay, first);
        await save(IDS.razorpay, second);
        const history = await changeHistoryText();
        for (const secret of [
          first.key_secret,
          first.webhook_secret,
          second.key_secret,
          second.webhook_secret,
        ]) {
          expect(history).not.toContain(secret);
        }
      });

      it("returns a changed key_secret on the next call without a restart", async () => {
        const before = razorpayValues();
        await save(IDS.razorpay, before);
        expect(await razorpayKeySecret()).toBe(before.key_secret);
        const after = razorpayValues({
          key_id: before.key_id,
          webhook_secret: before.webhook_secret,
        });
        await save(IDS.razorpay, after);
        expect(await razorpayKeySecret()).toBe(after.key_secret);
      });
    });

    describe("gst and legal identity card", () => {
      it("reports an unsaved card as incomplete", async () => {
        const res = await attempt("get", ROUTES.list);
        const entry = SHAPE.listEntries(res.data as { integrations?: unknown[] }).find(
          (e) => SHAPE.entryIdentifier(e) === IDS.gst
        );
        expect(entry).toBeDefined();
        expect(SHAPE.entryComplete(entry!)).toBe(false);
      });

      it("refuses an invalid GSTIN", async () => {
        const res = await save(IDS.gst, { ...GST_VALID, gstin: "27AAPFU0939F1ZX" });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });

      it("refuses a GSTIN whose state digits differ from the chosen state", async () => {
        const res = await save(IDS.gst, { ...GST_VALID, registered_state: "IN-KA" });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });

      it("refuses a bad PIN", async () => {
        const res = await save(IDS.gst, { ...GST_VALID, pin: "12345" });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });

      it("accepts the hand-computed valid sample with a matching state", async () => {
        const res = await save(IDS.gst, GST_VALID);
        expect(res.status).toBe(200);
      });
    });

    describe("smtp card", () => {
      it("returns the saved host with source card", async () => {
        await save(IDS.smtp, {
          host: "smtp.example.test",
          port: 587,
          secure: false,
          from: "shop@example.test",
        });
        clearOptionsCache();
        const { settings, source } = await getSmtpSettings(getContainer());
        expect(source).toBe("card");
        expect(settings.host).toBe("smtp.example.test");
      });

      it("returns a changed host on the next read", async () => {
        await save(IDS.smtp, {
          host: "one.example.test",
          port: 587,
          secure: false,
          from: "shop@example.test",
        });
        await save(IDS.smtp, {
          host: "two.example.test",
          port: 587,
          secure: false,
          from: "shop@example.test",
        });
        clearOptionsCache();
        const { settings } = await getSmtpSettings(getContainer());
        expect(settings.host).toBe("two.example.test");
      });
    });

    describe("vendor onboarding card", () => {
      it("makes the application reader return the saved expiry", async () => {
        await save(IDS.vendor, {
          invite_expiry_hours: 24,
          current_agreement_version: "v1-draft",
        });
        clearOptionsCache();
        const settings = await getVendorOnboardingSettings(getContainer());
        expect(settings.invite_expiry_hours).toBe(24);
      });

      it("returns the code default after the saved value is deleted", async () => {
        await save(IDS.vendor, {
          invite_expiry_hours: 24,
          current_agreement_version: "v1-draft",
        });
        const res = await attempt("delete", ROUTES.card(providerId(IDS.vendor)));
        expect(res.status).toBeLessThan(300);
        clearOptionsCache();
        const settings = await getVendorOnboardingSettings(getContainer());
        expect(settings.invite_expiry_hours).toBe(72);
      });

      it("makes the next invitation expiry follow the setting", async () => {
        await save(IDS.vendor, {
          invite_expiry_hours: 24,
          current_agreement_version: "v1-draft",
        });
        clearOptionsCache();
        const before = Date.now();
        const { result } = await inviteVendorWorkflow(getContainer()).run({
          input: {
            internal_name: `Cards invite ${randomBytes(3).toString("hex")}`,
            contact_name: "Cards Contact",
            contact_email: `cards-invite-${randomBytes(4).toString("hex")}@example.test`,
            actor: { id: "test_settings_cards", label: "settings-cards" },
            include_accept_url: true,
          },
        });
        const expiresAt = new Date(result.expires_at as string).getTime();
        const hours = (expiresAt - before) / (60 * 60 * 1000);
        expect(hours).toBeGreaterThan(23);
        expect(hours).toBeLessThan(25);
      });
    });
  },
});
