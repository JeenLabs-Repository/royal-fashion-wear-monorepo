import { randomBytes } from "node:crypto";
import type { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils";
import {
  createSalesChannelsWorkflow,
  createStoresWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { generatePassword } from "../../src/lib/staff-cli/password";
import { getVendorOnboardingSettings } from "../../src/lib/settings/vendor-onboarding";
import { acceptVendorAgreementWorkflow } from "../../src/workflows/vendors/accept-vendor-agreement";
import { acceptVendorInviteWorkflow } from "../../src/workflows/vendors/accept-vendor-invite";
import { activateVendorWorkflow } from "../../src/workflows/vendors/activate-vendor";
import { createVendorLocationWorkflow } from "../../src/workflows/vendors/create-vendor-location";
import { inviteVendorWorkflow } from "../../src/workflows/vendors/invite-vendor";
import { suspendVendorWorkflow } from "../../src/workflows/vendors/suspend-vendor";
import { probe, type ApiClient } from "./staff-users";

export type FixtureLocationSpec = {
  state_code: string;
  pin: string;
  status?: "active" | "inactive";
};

export type VendorFixtureOptions = {
  /** Used in the generated names and email address. */
  label: string;
  status?: "invited" | "active" | "suspended";
  /** Default true. False leaves the invitation unused and returns its link. */
  registered?: boolean;
  /** Default follows `registered`. */
  acceptAgreement?: boolean;
  locations?: FixtureLocationSpec[];
};

export type VendorFixture = {
  vendor_id: string;
  user_id: string;
  email: string;
  password: string;
  status: "invited" | "active" | "suspended";
  registered: boolean;
  /** Present only while the invitation is unused. */
  accept_url?: string;
  /** Lets a test mint a token for this vendor's user. */
  token_secret: string;
  locations: { id: string; code: string; stock_location_id: string; status: string }[];
};

type Query = {
  graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
};

const fixtureActor = { id: "user_vendor_fixture", label: "vendor-fixture@example.test" };

/**
 * Makes sure the store has a default sales channel. The test database can start
 * without one, and a vendor location is only linked to a channel that exists.
 */
export async function ensureDefaultSalesChannel(container: MedusaContainer): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as Query;
  let { data } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  });
  let store = data[0];
  if (!store) {
    await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: "Fixture Store",
            supported_currencies: [{ currency_code: "inr", is_default: true }],
          },
        ],
      },
    });
    ({ data } = await query.graph({
      entity: "store",
      fields: ["id", "default_sales_channel_id"],
    }));
    store = data[0];
  }
  if (store?.default_sales_channel_id) {
    return store.default_sales_channel_id as string;
  }
  const {
    result: [channel],
  } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: `Fixture Channel ${Date.now()}` }] },
  });
  await updateStoresWorkflow(container).run({
    input: { selector: { id: store.id }, update: { default_sales_channel_id: channel.id } },
  });
  return channel.id as string;
}

const slug = (label: string) => label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

const tokenFromLink = (url: string): string => {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The invite link has no token.");
  }
  return token;
};

export async function createVendorFixture(
  container: MedusaContainer,
  options: VendorFixtureOptions
): Promise<VendorFixture> {
  const status = options.status ?? "active";
  const registered = options.registered ?? true;
  const acceptAgreement = options.acceptAgreement ?? registered;
  if (status !== "invited" && !(registered && acceptAgreement)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "An active or suspended fixture must be registered with the agreement accepted."
    );
  }
  if (acceptAgreement && !registered) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The agreement can only be accepted by a registered vendor."
    );
  }

  await ensureDefaultSalesChannel(container);

  const random = randomBytes(4).toString("hex");
  const email = `vendor-${slug(options.label)}-${random}@example.test`;
  const password = generatePassword(20);

  const { result: invited } = await inviteVendorWorkflow(container).run({
    input: {
      internal_name: `Fixture ${options.label} ${random}`,
      contact_name: `Fixture Contact ${random}`,
      contact_email: email,
      actor: fixtureActor,
      include_accept_url: true,
    },
  });
  const acceptUrl = invited.accept_url as string | undefined;
  if (!acceptUrl) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The invite workflow returned no link for the fixture."
    );
  }

  if (registered) {
    await acceptVendorInviteWorkflow(container).run({
      input: { token: tokenFromLink(acceptUrl), password },
    });
  }

  if (acceptAgreement) {
    const { current_agreement_version: version } = await getVendorOnboardingSettings(container);
    await acceptVendorAgreementWorkflow(container).run({
      input: {
        vendor_user_id: invited.user_id,
        version,
        ip: "127.0.0.1",
        user_agent: "vendor-fixture",
      },
    });
  }

  const locations: VendorFixture["locations"] = [];
  for (const [index, spec] of (options.locations ?? []).entries()) {
    const { result } = await createVendorLocationWorkflow(container).run({
      input: {
        vendor_id: invited.vendor_id,
        label: `Fixture ${options.label} ${index + 1}`,
        state_code: spec.state_code,
        pin: spec.pin,
        address_1: "1 Fixture Road",
        pickup_contact_name: "Fixture Pickup",
        pickup_contact_phone: "+919800000000",
        status: spec.status ?? "active",
        actor: fixtureActor,
      },
    });
    locations.push({
      id: result.id,
      code: result.code,
      stock_location_id: result.stock_location_id,
      status: spec.status ?? "active",
    });
  }

  if (status !== "invited") {
    await activateVendorWorkflow(container).run({
      input: { vendor_id: invited.vendor_id, actor: fixtureActor },
    });
  }
  if (status === "suspended") {
    await suspendVendorWorkflow(container).run({
      input: {
        vendor_id: invited.vendor_id,
        reason: "Suspended by test fixture",
        actor: fixtureActor,
      },
    });
  }

  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as {
    projectConfig: { http: { jwtSecret?: string } };
  };
  const tokenSecret = config.projectConfig.http.jwtSecret;
  if (!tokenSecret) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The test app has no jwtSecret");
  }

  return {
    vendor_id: invited.vendor_id,
    user_id: invited.user_id,
    email,
    password,
    status,
    registered,
    ...(registered ? {} : { accept_url: acceptUrl }),
    token_secret: tokenSecret,
    locations,
  };
}

/** Signs in through the real endpoint and returns the bearer token. */
export async function vendorLogin(
  api: ApiClient,
  credentials: { email: string; password: string }
): Promise<string> {
  const result = await probe(api, {}, "POST", "/auth/vendor/emailpass", {
    email: credentials.email,
    password: credentials.password,
  });
  const token = (result.body as { token?: string } | undefined)?.token;
  if (result.status !== 200 || !token) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      `Vendor sign-in failed with status ${result.status}`
    );
  }
  return token;
}

export const vendorBearer = (token: string): { authorization: string } => ({
  authorization: `Bearer ${token}`,
});

/** The claims of a signed token, read without checking the signature. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const body = token.split(".")[1];
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
}
