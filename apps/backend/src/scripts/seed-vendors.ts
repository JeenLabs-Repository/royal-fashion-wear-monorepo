import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { deleteStockLocationsWorkflow } from "@medusajs/medusa/core-flows";
import { getVendorOnboardingSettings } from "../lib/settings/vendor-onboarding";
import {
  CREDENTIALS_FILE_NAME,
  assertIgnoredByGit,
  findRepoRoot,
} from "../lib/staff-cli/credentials-file";
import { positionalArgs } from "../lib/staff-cli/operations";
import { getVendorModule, logWith } from "../lib/vendor/vendor-module";
import { acceptVendorAgreementWorkflow } from "../workflows/vendors/accept-vendor-agreement";
import { acceptVendorInviteWorkflow } from "../workflows/vendors/accept-vendor-invite";
import { activateVendorWorkflow } from "../workflows/vendors/activate-vendor";
import { createVendorLocationWorkflow } from "../workflows/vendors/create-vendor-location";
import { inviteVendorWorkflow } from "../workflows/vendors/invite-vendor";
import { resendVendorInviteWorkflow } from "../workflows/vendors/resend-vendor-invite";
import { suspendVendorWorkflow } from "../workflows/vendors/suspend-vendor";
import {
  DEMO_VENDORS,
  DEMO_VENDOR_NAME_PREFIX,
  FRESH_INVITE_NAME_PREFIX,
  freshInviteVendor,
  type DemoVendor,
} from "./demo-data/vendors";
import { seedCatalogDemo } from "./lib/catalog-demo";
import { createFreshVendor, removeFreshVendors } from "./lib/fresh-vendor";

const VENDOR_SEED_START = "<!-- vendor-seed:start -->";
const VENDOR_SEED_END = "<!-- vendor-seed:end -->";
const USAGE =
  "Usage: pnpm -C apps/backend exec medusa exec ./src/scripts/seed-vendors.ts [--fresh-invite] [--fresh-vendor] [--status active] [--reset] [--out-dir <dir>] [--catalog]";

const seedActor = { id: "seed-vendors", label: "seed-vendors" };

export type SeedRecord = {
  key: string;
  internal_name: string;
  email: string;
  password: string;
  status: string;
  registered: boolean;
  agreement_accepted: boolean;
  vendor_id: string;
  user_id: string;
  locations: { id: string; code: string; state_code: string; pin: string; stock_location_id: string }[];
  accept_url: string | null;
  purpose: string;
};

export type SeedSummary = {
  created: string[];
  existing: string[];
  removed: string[];
  credentials_path: string | null;
  json_path: string | null;
};

type Options = {
  freshInvite: boolean;
  freshVendor: boolean;
  freshVendorStatus: "invited" | "active";
  reset: boolean;
  catalog: boolean;
  outDir: string | null;
};

// Accepts both `--fresh-invite` and the bare word, because the runner may keep
// the dashes for itself. `--out-dir <dir>` and `out-dir=<dir>` both work.
function parseOptions(args: string[] | undefined): Options {
  const words = positionalArgs(args);
  const has = (name: string) => words.includes(`--${name}`) || words.includes(name);
  let outDir: string | null = null;
  let status: "invited" | "active" = "invited";
  for (const [index, word] of words.entries()) {
    const match = /^(?:--)?out-dir=(.+)$/.exec(word);
    if (match) {
      outDir = match[1];
    } else if (word === "--out-dir" || word === "out-dir") {
      outDir = words[index + 1] ?? null;
    }
    const statusMatch = /^(?:--)?status=(.+)$/.exec(word);
    if (statusMatch) {
      status = statusMatch[1] === "active" ? "active" : "invited";
    } else if (word === "--status" || word === "status") {
      status = words[index + 1] === "active" ? "active" : "invited";
    }
  }
  const known = new Set([
    "--fresh-invite",
    "fresh-invite",
    "--fresh-vendor",
    "fresh-vendor",
    "--status",
    "status",
    "active",
    "invited",
    "--reset",
    "reset",
    "--catalog",
    "catalog",
    "--out-dir",
    "out-dir",
  ]);
  for (const [index, word] of words.entries()) {
    const prev = words[index - 1]?.replace(/^--/, "");
    const isOutDirValue = outDir !== null && prev === "out-dir";
    const isStatusValue = prev === "status" && (word === "active" || word === "invited");
    if (!known.has(word) && !/^(?:--)?out-dir=/.test(word) && !/^(?:--)?status=/.test(word) && !isOutDirValue && !isStatusValue) {
      // A plain Error is right here. Scripts under src/scripts never serve a request.
      throw new Error(USAGE);
    }
  }
  return {
    freshInvite: has("fresh-invite"),
    freshVendor: has("fresh-vendor"),
    freshVendorStatus: status,
    reset: has("reset"),
    catalog: has("catalog"),
    outDir,
  };
}

const tokenFromLink = (url: string): string => {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The invite link has no token.");
  }
  return token;
};

/** Describes a vendor that already exists, found through its user email. */
async function describeExisting(
  container: MedusaContainer,
  spec: DemoVendor
): Promise<SeedRecord | null> {
  const vendorModule = getVendorModule(container);
  const [user] = await vendorModule.listVendorUsers({ email: spec.email }, { take: 1 });
  if (!user) {
    return null;
  }
  const [vendor] = await vendorModule.listVendors({ id: user.vendor_id }, { take: 1 });
  const locations = await vendorModule.listVendorLocations(
    { vendor_id: user.vendor_id },
    { take: null, order: { code: "ASC" } }
  );
  const invites = await vendorModule.listVendorInvites(
    { vendor_user_id: user.id },
    { take: null }
  );
  const settings = await getVendorOnboardingSettings(container);
  const accepted = await vendorModule.listVendorAgreementAcceptances(
    { vendor_user_id: user.id, version: settings.current_agreement_version },
    { take: 1 }
  );
  return {
    key: spec.key,
    internal_name: vendor.internal_name,
    email: spec.email,
    password: spec.password,
    status: vendor.status,
    registered: invites.some((invite) => Boolean(invite.used_at)),
    agreement_accepted: accepted.length > 0,
    vendor_id: vendor.id,
    user_id: user.id,
    locations: locations.map((location) => ({
      id: location.id,
      code: location.code,
      state_code: location.state_code,
      pin: location.pin,
      stock_location_id: location.stock_location_id as string,
    })),
    accept_url: null,
    purpose: spec.purpose,
  };
}

/** Creates one demo vendor through the same workflows the admin uses. */
async function createDemoVendor(
  container: MedusaContainer,
  spec: DemoVendor
): Promise<SeedRecord> {
  const { result: invited } = await inviteVendorWorkflow(container).run({
    input: {
      internal_name: spec.internal_name,
      contact_name: spec.contact_name,
      contact_email: spec.email,
      actor: seedActor,
      include_accept_url: true,
    },
  });
  const acceptUrl = invited.accept_url as string | undefined;
  if (!acceptUrl) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The invite workflow returned no link."
    );
  }

  if (spec.registered) {
    await acceptVendorInviteWorkflow(container).run({
      input: { token: tokenFromLink(acceptUrl), password: spec.password },
    });
  }
  if (spec.agreement_accepted) {
    const { current_agreement_version: version } = await getVendorOnboardingSettings(container);
    await acceptVendorAgreementWorkflow(container).run({
      input: { vendor_user_id: invited.user_id, version, ip: "127.0.0.1", user_agent: "seed-vendors" },
    });
  }
  for (const [index, location] of spec.locations.entries()) {
    await createVendorLocationWorkflow(container).run({
      input: {
        vendor_id: invited.vendor_id,
        label: `${spec.internal_name} site ${index + 1}`,
        state_code: location.state_code,
        pin: location.pin,
        address_1: "1 Demo Road",
        pickup_contact_name: spec.contact_name,
        pickup_contact_phone: "+919800000000",
        status: location.status ?? "active",
        actor: seedActor,
      },
    });
  }
  if (spec.target_status !== "invited") {
    await activateVendorWorkflow(container).run({
      input: { vendor_id: invited.vendor_id, actor: seedActor },
    });
  }
  if (spec.target_status === "suspended") {
    await suspendVendorWorkflow(container).run({
      input: {
        vendor_id: invited.vendor_id,
        reason: "Demo vendor kept suspended on purpose",
        actor: seedActor,
      },
    });
  }

  const described = await describeExisting(container, spec);
  if (!described) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The demo vendor was not saved.");
  }
  return { ...described, accept_url: spec.registered ? null : acceptUrl };
}

/** An invitation that was never accepted gets a new link on every run. */
async function refreshInvite(container: MedusaContainer, record: SeedRecord): Promise<SeedRecord> {
  if (record.registered || record.status !== "invited") {
    return record;
  }
  const { result } = await resendVendorInviteWorkflow(container).run({
    input: { vendor_id: record.vendor_id, actor: seedActor, include_accept_url: true },
  });
  return { ...record, accept_url: (result.accept_url as string | undefined) ?? null };
}

/** Removes every demo vendor, its users, invitations, locations, stock locations and sign-in identities. */
async function removeDemoVendors(container: MedusaContainer): Promise<string[]> {
  const vendorModule = getVendorModule(container);
  const auth = container.resolve(Modules.AUTH) as {
    listAuthIdentities(filter: Record<string, unknown>, config?: Record<string, unknown>): Promise<{ id: string }[]>;
    deleteAuthIdentities(ids: string[]): Promise<unknown>;
  };
  const vendors = await vendorModule.listVendors(
    { internal_name: { $like: `${DEMO_VENDOR_NAME_PREFIX}%` } },
    { take: null }
  );
  const removed: string[] = [];
  for (const vendor of vendors) {
    const users = await vendorModule.listVendorUsers({ vendor_id: vendor.id }, { take: null });
    const userIds = users.map((user) => user.id);
    const locations = await vendorModule.listVendorLocations({ vendor_id: vendor.id }, { take: null });
    const stockLocationIds = locations
      .map((location) => location.stock_location_id)
      .filter((id): id is string => Boolean(id));
    if (stockLocationIds.length > 0) {
      await deleteStockLocationsWorkflow(container).run({ input: { ids: stockLocationIds } });
    }
    if (userIds.length > 0) {
      const acceptances = await vendorModule.listVendorAgreementAcceptances(
        { vendor_user_id: userIds },
        { select: ["id"], take: null }
      );
      const invites = await vendorModule.listVendorInvites(
        { vendor_user_id: userIds },
        { select: ["id"], take: null }
      );
      if (acceptances.length) {
        await vendorModule.deleteVendorAgreementAcceptances(acceptances.map((row) => row.id));
      }
      if (invites.length) {
        await vendorModule.deleteVendorInvites(invites.map((row) => row.id));
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
    removed.push(vendor.internal_name);
  }
  return removed;
}

const cell = (value: string): string => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

function renderCredentialsBlock(records: SeedRecord[], removedOnly: boolean): string {
  if (removedOnly) {
    return [
      "### Vendor Demo Data",
      "",
      "No demo vendors exist. Run the seed again to create them: `pnpm -C apps/backend exec medusa exec ./src/scripts/seed-vendors.ts`.",
    ].join("\n");
  }
  const lines = [
    "### Vendor Demo Data",
    "",
    "| Account | Email | Password | Status | Locations | Created by | How to reset |",
    "|---|---|---|---|---|---|---|",
    ...records.map((record) =>
      [
        `${cell(record.internal_name)} (${cell(record.purpose)})`,
        record.email,
        record.password,
        cell(
          `${record.status}${record.registered ? ", registered" : ", not registered"}${
            record.agreement_accepted ? ", agreement accepted" : ""
          }`
        ),
        record.locations.map((location) => location.code).join(" ") || "none",
        "seed-vendors",
        "rerun with `--reset`",
      ]
        .map((value) => `| ${value} `)
        .join("")
        .concat("|")
    ),
    "",
  ];
  for (const record of records.filter((row) => row.accept_url)) {
    lines.push(`Invitation link for ${record.internal_name}: ${record.accept_url}`, "");
  }
  lines.push(
    "How to reset: rerun the seed with `--reset`, then run it again without it.",
    "TOTP secrets created while testing are appended by hand under \"MFA secrets\"."
  );
  return lines.join("\n");
}

/** Replaces only the marked section, or appends it when the file has none. */
export function applyMarkedBlock(text: string, block: string): string {
  const wrapped = `${VENDOR_SEED_START}\n${block}\n${VENDOR_SEED_END}`;
  const start = text.indexOf(VENDOR_SEED_START);
  const end = text.indexOf(VENDOR_SEED_END);
  if (start !== -1 && end > start) {
    return `${text.slice(0, start)}${wrapped}${text.slice(end + VENDOR_SEED_END.length)}`;
  }
  const separator = text.length === 0 || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${separator}${wrapped}\n`;
}

export default async function seedVendors({ container, args }: ExecArgs): Promise<SeedSummary> {
  if (process.env.NODE_ENV === "production") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "The demo vendor seed refuses to run when NODE_ENV is production."
    );
  }
  const options = parseOptions(args);

  // Resolve and check the output locations before anything is created, so a
  // password that cannot be recorded is never generated.
  let baseDir: string;
  if (options.outDir) {
    baseDir = path.resolve(options.outDir);
    mkdirSync(baseDir, { recursive: true });
  } else {
    baseDir = findRepoRoot();
    assertIgnoredByGit(baseDir);
  }
  const credentialsPath = path.join(baseDir, CREDENTIALS_FILE_NAME);
  const jsonPath = path.join(baseDir, "e2e", ".auth", "vendor-seed.json");

  const summary: SeedSummary = {
    created: [],
    existing: [],
    removed: [],
    credentials_path: null,
    json_path: null,
  };

  const writeCredentials = (block: string) => {
    const templatePath = path.join(baseDir, "docs", "testing", "test-credentials.template.md");
    const base = existsSync(credentialsPath)
      ? readFileSync(credentialsPath, "utf8")
      : existsSync(templatePath)
        ? readFileSync(templatePath, "utf8")
        : "# Test Credentials (local, never commit)\n";
    writeFileSync(credentialsPath, applyMarkedBlock(base, block));
    summary.credentials_path = credentialsPath;
  };

  if (options.catalog) {
    await seedCatalogDemo(container);
    return summary;
  }

  if (options.freshVendor) {
    const fresh = await createFreshVendor(container, {
      status: options.freshVendorStatus,
      outDir: path.dirname(jsonPath),
      credentialsPath,
    });
    summary.created.push(fresh.name);
    summary.credentials_path = credentialsPath;
    summary.json_path = jsonPath;
    console.log(
      `[seed-vendors] fresh vendor ${fresh.name} written to the seed file and the credentials file`
    );
    return summary;
  }

  if (options.reset) {
    const removedFresh = await removeFreshVendors(container);
    console.log(`[seed-vendors] removed ${removedFresh} fresh vendor(s)`);
    summary.removed = await removeDemoVendors(container);
    writeCredentials(renderCredentialsBlock([], true));
    rmSync(jsonPath, { force: true });
    logWith(container, "info", `[seed-vendors] removed ${summary.removed.length} demo vendor(s)`);
    console.log(`Removed ${summary.removed.length} demo vendor(s).`);
    return summary;
  }

  // Keep what an earlier run recorded for the fresh invitations.
  const previousJson = existsSync(jsonPath)
    ? (JSON.parse(readFileSync(jsonPath, "utf8")) as { fresh_invite?: SeedRecord | null })
    : {};

  const records: SeedRecord[] = [];
  for (const spec of DEMO_VENDORS) {
    const existing = await describeExisting(container, spec);
    if (existing) {
      summary.existing.push(spec.internal_name);
      records.push(await refreshInvite(container, existing));
    } else {
      summary.created.push(spec.internal_name);
      records.push(await createDemoVendor(container, spec));
    }
  }

  let freshInvite: SeedRecord | null = previousJson.fresh_invite ?? null;
  if (options.freshInvite) {
    const vendorModule = getVendorModule(container);
    const numbered = await vendorModule.listVendors(
      { internal_name: { $like: `${FRESH_INVITE_NAME_PREFIX}%` } },
      { take: null, select: ["id"] }
    );
    const spec = freshInviteVendor(numbered.length + 1);
    summary.created.push(spec.internal_name);
    freshInvite = await createDemoVendor(container, spec);
  }

  const shown = freshInvite ? [...records, freshInvite] : records;
  writeCredentials(renderCredentialsBlock(shown, false));

  mkdirSync(path.dirname(jsonPath), { recursive: true });
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        portal_url: process.env.VENDOR_PORTAL_URL ?? "http://localhost:5173/vendor-portal",
        vendors: Object.fromEntries(records.map((record) => [record.key, record])),
        fresh_invite: freshInvite,
      },
      null,
      2
    )
  );
  summary.json_path = jsonPath;

  if (summary.created.length === 0) {
    console.log("Nothing to create. Every demo vendor already exists.");
  } else {
    console.log(`Created: ${summary.created.join(", ")}.`);
  }
  console.log(`Credentials section written to ${credentialsPath}`);
  console.log(`Seed manifest written to ${jsonPath}`);
  return summary;
}
