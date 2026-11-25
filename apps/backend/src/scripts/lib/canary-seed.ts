import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MedusaContainer } from "@medusajs/framework/types";
import { randomBytes } from "node:crypto";
import type { ConfigModule, IAuthModuleService, IUserModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows";
import { getStoreSalesChannelId } from "../../lib/vendor/channel-links";
import { getVendorOnboardingSettings } from "../../lib/settings/vendor-onboarding";
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access";
import { VENDOR_MODULE } from "../../modules/vendor";
import { acceptVendorAgreementWorkflow } from "../../workflows/vendors/accept-vendor-agreement";
import { acceptVendorInviteWorkflow } from "../../workflows/vendors/accept-vendor-invite";
import { activateVendorWorkflow } from "../../workflows/vendors/activate-vendor";
import { createVendorLocationWorkflow } from "../../workflows/vendors/create-vendor-location";
import { inviteVendorWorkflow } from "../../workflows/vendors/invite-vendor";
import { suspendVendorWorkflow } from "../../workflows/vendors/suspend-vendor";
import { CANARY_VENDORS, type CanaryVendor } from "../demo-data/canary";

const KEY_TITLE = "canary-publishable";
const ACTOR = { id: "seed:canary" };
const APPROVER_PASSWORD = "Canary-Approver-Passw0rd-2026!";

type VendorService = {
  listVendorUsers: (filter: Record<string, unknown>) => Promise<{ id: string; vendor_id: string; email: string }[]>;
  listVendorLocations: (filter: Record<string, unknown>) => Promise<{ code: string }[]>;
};

type ManifestVendor = {
  vendor_id: string;
  user_id: string;
  email: string;
  password: string;
  status: string;
  location_codes: string[];
  totp_secret?: string;
};

// The staff user the catalog surfaces sign in as. The fields are the ones the test
// helper `staffHeaders` reads to mint a token for an enrolled user.
export type ManifestApprover = {
  id: string;
  email: string;
  password: string;
  identityId: string;
  roleKeys: string[];
  isBreakGlass: boolean;
  mfaEnrolled: boolean;
  tokenSecret: string;
};

export type CanaryManifestFile = {
  publishable_key: string;
  generated_at: string;
  vendors: Record<string, ManifestVendor>;
  approver?: ManifestApprover;
};

const findRepoRoot = (): string => {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("[seed-canary] Could not find pnpm-workspace.yaml above the working directory.");
    }
    dir = parent;
  }
};

const tokenFromAcceptUrl = (acceptUrl: string): string => {
  const token = new URLSearchParams(new URL(acceptUrl).hash.replace(/^#/, "")).get("token");
  if (!token) {
    throw new Error("[seed-canary] The accept URL carries no token in its fragment.");
  }
  return token;
};

const ensureVendor = async (container: MedusaContainer, vendor: CanaryVendor): Promise<ManifestVendor> => {
  const service = container.resolve(VENDOR_MODULE) as unknown as VendorService;
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const [existing] = await service.listVendorUsers({ email: vendor.email });
  let vendorId: string;
  let userId: string;

  if (existing) {
    vendorId = existing.vendor_id;
    userId = existing.id;
    logger.info(`[seed-canary] ${vendor.key} exists, keeping it`);
  } else {
    const settings = await getVendorOnboardingSettings(container);
    const version = settings.current_agreement_version;

    const { result: invited } = await inviteVendorWorkflow(container).run({
      input: {
        internal_name: vendor.internal_name,
        contact_name: vendor.contact_name,
        contact_email: vendor.email,
        note: vendor.note,
        actor: ACTOR,
        include_accept_url: true,
      },
    });
    vendorId = invited.vendor_id;
    userId = invited.user_id;

    await acceptVendorInviteWorkflow(container).run({
      input: { token: tokenFromAcceptUrl(invited.accept_url as string), password: vendor.password },
    });

    await acceptVendorAgreementWorkflow(container).run({
      input: { vendor_user_id: userId, version, ip: "127.0.0.1", user_agent: "canary-seed" },
    });

    await createVendorLocationWorkflow(container).run({
      input: {
        vendor_id: vendorId,
        label: vendor.location.label,
        state_code: vendor.location.state_code,
        pin: vendor.location.pin,
        address_1: vendor.location.address_1,
        address_2: vendor.location.address_2,
        city: vendor.location.city,
        pickup_contact_name: vendor.location.pickup_contact_name,
        pickup_contact_phone: vendor.location.pickup_contact_phone,
        status: "active",
        actor: ACTOR,
      },
    });

    await activateVendorWorkflow(container).run({ input: { vendor_id: vendorId, actor: ACTOR } });

    if (vendor.status === "suspended") {
      await suspendVendorWorkflow(container).run({
        input: { vendor_id: vendorId, reason: vendor.suspend_reason, actor: ACTOR },
      });
    }
    logger.info(`[seed-canary] created ${vendor.key}`);
  }

  const locations = await service.listVendorLocations({ vendor_id: vendorId });
  return {
    vendor_id: vendorId,
    user_id: userId,
    email: vendor.email,
    password: vendor.password,
    status: vendor.status,
    location_codes: locations.map((location) => location.code),
  };
};

const ensurePublishableKey = async (container: MedusaContainer): Promise<string> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "api_key",
    fields: ["id", "token", "title"],
    filters: { title: KEY_TITLE },
  });
  if (data[0]?.token) {
    return data[0].token as string;
  }

  const { result } = await createApiKeysWorkflow(container).run({
    input: { api_keys: [{ title: KEY_TITLE, type: "publishable", created_by: "seed:canary" }] },
  });
  const key = result[0];
  const salesChannelId = await getStoreSalesChannelId(container);
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: key.id, add: [salesChannelId] },
  });
  return key.token as string;
};

// One catalog approver for the catalog surfaces. Built in the seed (not via the
// integration-tests helper) so `medusa exec` does not resolve test-only ESM paths.
const ensureApprover = async (
  container: MedusaContainer,
  previous: ManifestApprover | undefined
): Promise<ManifestApprover> => {
  const users = container.resolve(Modules.USER) as IUserModuleService;
  if (previous) {
    const [existing] = await users.listUsers({ id: previous.id }, { take: 1 });
    if (existing) {
      return previous;
    }
  }

  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as ConfigModule;
  const tokenSecret = config.projectConfig.http.jwtSecret;
  if (typeof tokenSecret !== "string" || tokenSecret.length === 0) {
    throw new Error("[seed-canary] The app has no jwtSecret; cannot mint catalog approver tokens.");
  }

  const email = `canary-approver-${randomBytes(4).toString("hex")}@canary.invalid`;
  const user = await users.createUsers({ email });
  const auth = container.resolve(Modules.AUTH) as IAuthModuleService;
  const registered = (await auth.register("emailpass", {
    body: { email, password: APPROVER_PASSWORD },
  } as never)) as { success: boolean; authIdentity?: { id: string }; error?: string };
  if (!registered.success || !registered.authIdentity) {
    throw new Error(`[seed-canary] Could not register the catalog approver: ${registered.error ?? "unknown"}`);
  }
  await auth.updateAuthIdentities({
    id: registered.authIdentity.id,
    app_metadata: { user_id: user.id },
  });

  const staff = container.resolve(STAFF_ACCESS_MODULE) as {
    createStaffAssignments(rows: Array<Record<string, unknown>>): Promise<unknown>;
  };
  await staff.createStaffAssignments([
    {
      user_id: user.id,
      role_key: "catalog_approver",
      is_break_glass: false,
      assigned_by: "seed:canary",
    },
  ]);

  return {
    id: user.id,
    email,
    password: APPROVER_PASSWORD,
    identityId: registered.authIdentity.id,
    roleKeys: ["catalog_approver"],
    isBreakGlass: false,
    mfaEnrolled: true,
    tokenSecret,
  };
};

export const seedCanary = async (
  container: MedusaContainer,
  options: { outDir?: string } = {}
): Promise<{ manifestPath: string; manifest: CanaryManifestFile }> => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[seed-canary] Refusing to run in production.");
  }

  const outDir = options.outDir ?? path.join(findRepoRoot(), "e2e", ".auth");
  const manifestPath = path.join(outDir, "canary-seed.json");

  // Keep two-factor secrets a previous crawl stored, so a rerun can still sign in.
  let previous: Partial<CanaryManifestFile> = {};
  if (existsSync(manifestPath)) {
    try {
      previous = JSON.parse(readFileSync(manifestPath, "utf8")) as CanaryManifestFile;
    } catch {
      previous = {};
    }
  }

  const vendors: Record<string, ManifestVendor> = {};
  for (const vendor of Object.values(CANARY_VENDORS)) {
    const entry = await ensureVendor(container, vendor);
    const secret = previous.vendors?.[vendor.key]?.totp_secret;
    vendors[vendor.key] = secret ? { ...entry, totp_secret: secret } : entry;
  }

  const manifest: CanaryManifestFile = {
    publishable_key: await ensurePublishableKey(container),
    generated_at: new Date().toISOString(),
    vendors,
    approver: await ensureApprover(container, previous.approver),
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest };
};
