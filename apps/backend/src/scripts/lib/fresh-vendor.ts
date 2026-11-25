import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { deleteStockLocationsWorkflow } from "@medusajs/medusa/core-flows";
import { getVendorOnboardingSettings } from "../../lib/settings/vendor-onboarding";
import { getVendorModule, logWith } from "../../lib/vendor/vendor-module";
import { acceptVendorAgreementWorkflow } from "../../workflows/vendors/accept-vendor-agreement";
import { acceptVendorInviteWorkflow } from "../../workflows/vendors/accept-vendor-invite";
import { activateVendorWorkflow } from "../../workflows/vendors/activate-vendor";
import { createVendorLocationWorkflow } from "../../workflows/vendors/create-vendor-location";
import { inviteVendorWorkflow } from "../../workflows/vendors/invite-vendor";
import { FRESH_VENDOR_TEMPLATE } from "../demo-data/vendors";

const ACTOR = { id: "seed-vendors", label: "seed-vendors" };
const START = "<!-- vendor-fresh:start -->";
const END = "<!-- vendor-fresh:end -->";

export type FreshVendor = {
  vendor_id: string;
  user_id: string;
  name: string;
  email: string;
  password: string;
  status: "invited" | "active";
  location_codes: string[];
};

const findRepoRoot = (): string => {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "[seed-vendors] Could not find pnpm-workspace.yaml above the working directory."
      );
    }
    dir = parent;
  }
};

const tokenFromAcceptUrl = (acceptUrl: string): string => {
  const token = new URLSearchParams(new URL(acceptUrl).hash.replace(/^#/, "")).get("token");
  if (!token) {
    throw new Error("[seed-vendors] The accept URL carries no token in its fragment.");
  }
  return token;
};

const writeSeedFile = (outDir: string, fresh: FreshVendor): string => {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "vendor-seed.json");
  let current: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      current = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      current = {};
    }
  }
  current.fresh_vendor = fresh;
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  return file;
};

const credentialsRow = (fresh: FreshVendor): string =>
  `| ${fresh.name} | fresh vendor option of the vendor seed (${fresh.status}) | email ${fresh.email}; password ${fresh.password}; locations ${fresh.location_codes.join(" ")} | rerun the seed with --reset |`;

// Adds one row per fresh vendor inside its own marked section of the untracked
// credentials file, keeping the rows that are already there.
const writeCredentials = (credentialsPath: string, fresh: FreshVendor): void => {
  const header = [
    "## Fresh vendors",
    "",
    "| What | Flow | Values | How to reset |",
    "|---|---|---|---|",
  ];
  const text = existsSync(credentialsPath)
    ? readFileSync(credentialsPath, "utf8")
    : "# Test credentials\n";

  const start = text.indexOf(START);
  const end = text.indexOf(END);
  const rows =
    start >= 0 && end > start
      ? text
          .slice(start + START.length, end)
          .split("\n")
          .filter((line) => line.startsWith("| Demo Vendor Fresh"))
      : [];
  rows.push(credentialsRow(fresh));

  const section = `${START}\n${[...header, ...rows].join("\n")}\n${END}`;
  const next =
    start >= 0 && end > start
      ? `${text.slice(0, start)}${section}${text.slice(end + END.length)}`
      : `${text}${text.endsWith("\n") ? "" : "\n"}\n${section}\n`;
  writeFileSync(credentialsPath, next);
};

export const createFreshVendor = async (
  container: MedusaContainer,
  options: {
    status?: "invited" | "active";
    outDir?: string;
    credentialsPath?: string;
  } = {}
): Promise<FreshVendor> => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[seed-vendors] Refusing to run in production.");
  }

  const status = options.status ?? "invited";
  const stamp = `${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
  const name = `${FRESH_VENDOR_TEMPLATE.name_prefix} ${stamp}`;
  const email = `${FRESH_VENDOR_TEMPLATE.email_prefix}-${stamp}@example.test`;
  const password = `${FRESH_VENDOR_TEMPLATE.password_prefix}-${stamp}`;

  const { result: invited } = await inviteVendorWorkflow(container).run({
    input: {
      internal_name: name,
      contact_name: FRESH_VENDOR_TEMPLATE.contact_name,
      contact_email: email,
      actor: ACTOR,
      include_accept_url: true,
    },
  });

  const acceptUrl = invited.accept_url as string | undefined;
  if (!acceptUrl) {
    throw new Error("[seed-vendors] The invite workflow returned no link.");
  }

  await acceptVendorInviteWorkflow(container).run({
    input: { token: tokenFromAcceptUrl(acceptUrl), password },
  });

  for (const location of FRESH_VENDOR_TEMPLATE.locations) {
    await createVendorLocationWorkflow(container).run({
      input: {
        vendor_id: invited.vendor_id,
        label: location.label,
        address_1: location.address_1,
        city: location.city,
        state_code: location.state_code,
        pin: location.pin,
        pickup_contact_name: location.pickup_contact_name,
        pickup_contact_phone: location.pickup_contact_phone,
        status: "active",
        actor: ACTOR,
      },
    });
  }

  if (status === "active") {
    const settings = await getVendorOnboardingSettings(container);
    await acceptVendorAgreementWorkflow(container).run({
      input: {
        vendor_user_id: invited.user_id,
        version: settings.current_agreement_version,
        ip: "127.0.0.1",
        user_agent: "vendor-seed",
      },
    });
    await activateVendorWorkflow(container).run({
      input: { vendor_id: invited.vendor_id, actor: ACTOR },
    });
  }

  const vendorModule = getVendorModule(container);
  const locations = await vendorModule.listVendorLocations(
    { vendor_id: invited.vendor_id },
    { take: null, order: { code: "ASC" } }
  );

  const fresh: FreshVendor = {
    vendor_id: invited.vendor_id,
    user_id: invited.user_id,
    name,
    email,
    password,
    status,
    location_codes: locations.map((location) => String(location.code)),
  };

  const root = findRepoRoot();
  writeSeedFile(options.outDir ?? path.join(root, "e2e", ".auth"), fresh);
  writeCredentials(
    options.credentialsPath ?? path.join(root, "TEST-CREDENTIALS.local.md"),
    fresh
  );

  logWith(container, "info", `[seed-vendors] created ${name} (${status})`);
  return fresh;
};

// Removes every fresh vendor with its users, invites, acceptances, locations,
// stock locations and sign-in identities. Called from the seed's reset path.
export const removeFreshVendors = async (container: MedusaContainer): Promise<number> => {
  const vendorModule = getVendorModule(container);
  const auth = container.resolve(Modules.AUTH) as {
    listAuthIdentities(
      filter: Record<string, unknown>,
      config?: Record<string, unknown>
    ): Promise<{ id: string }[]>;
    deleteAuthIdentities(ids: string[]): Promise<unknown>;
  };

  const vendors = await vendorModule.listVendors(
    { internal_name: { $like: `${FRESH_VENDOR_TEMPLATE.name_prefix}%` } },
    { take: null }
  );

  for (const vendor of vendors) {
    const users = await vendorModule.listVendorUsers({ vendor_id: vendor.id }, { take: null });
    const locations = await vendorModule.listVendorLocations(
      { vendor_id: vendor.id },
      { take: null }
    );

    const stockIds = locations
      .map((location) => location.stock_location_id)
      .filter((id): id is string => Boolean(id));
    if (stockIds.length > 0) {
      await deleteStockLocationsWorkflow(container).run({ input: { ids: stockIds } });
    }

    const userIds = users.map((user) => user.id);
    if (userIds.length > 0) {
      const invites = await vendorModule.listVendorInvites(
        { vendor_user_id: userIds },
        { select: ["id"], take: null }
      );
      const acceptances = await vendorModule.listVendorAgreementAcceptances(
        { vendor_user_id: userIds },
        { select: ["id"], take: null }
      );
      if (invites.length) {
        await vendorModule.deleteVendorInvites(invites.map((row) => row.id));
      }
      if (acceptances.length) {
        await vendorModule.deleteVendorAgreementAcceptances(acceptances.map((row) => row.id));
      }
    }

    if (locations.length) {
      await vendorModule.deleteVendorLocations(locations.map((row) => row.id));
    }

    for (const user of users) {
      const identities = await auth.listAuthIdentities(
        { provider_identities: { provider: "emailpass", entity_id: [user.email] } },
        { take: null }
      );
      if (identities.length) {
        await auth.deleteAuthIdentities(identities.map((row) => row.id));
      }
    }

    if (userIds.length) {
      await vendorModule.deleteVendorUsers(userIds);
    }
    await vendorModule.deleteVendors([vendor.id]);
  }

  return vendors.length;
};
