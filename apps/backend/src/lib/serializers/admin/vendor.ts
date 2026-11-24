import type { MedusaContainer } from "@medusajs/framework/types";
import { getVendorEligibility } from "../../vendor/eligibility";
import { getOnboardingSteps } from "../../vendor/onboarding-steps";
import { getVendorModule } from "../../vendor/vendor-module";
import { defineAllowlistSerializer } from "../define-allowlist-serializer";
import { toVendorLocationView } from "../vendor/location";

const LOCATION_SHAPE = {
  id: true,
  code: true,
  label: true,
  state_code: true,
  state_name: true,
  pin: true,
  address_1: true,
  address_2: true,
  city: true,
  pickup_contact_name: true,
  pickup_contact_phone: true,
  status: true,
  stock_location_id: true,
} as const;

// The owner sees everything about a vendor except what could open the account
// to someone else. No invitation secret, link or hash is part of this shape.
export const adminVendorSerializer = defineAllowlistSerializer({
  name: "admin-vendor",
  audience: "admin",
  shape: {
    id: true,
    internal_name: true,
    contact_name: true,
    contact_email: true,
    status: true,
    activated_at: true,
    suspended_at: true,
    suspend_reason: true,
    note: true,
    eligible_to_list: true,
    locations_count: true,
    created_at: true,
    user: {
      id: true,
      email: true,
      name: true,
      registered: true,
      invite_state: true,
      invite_expires_at: true,
    },
    locations: LOCATION_SHAPE,
    onboarding_steps: {
      key: true,
      title: true,
      required_for_activation: true,
      complete: true,
      link: true,
    },
  },
});

export const adminVendorLocationSerializer = defineAllowlistSerializer({
  name: "admin-vendor-location",
  audience: "admin",
  shape: LOCATION_SHAPE,
});

type VendorRow = {
  id: string;
  status: string;
  [key: string]: unknown;
};

type InviteRow = { vendor_user_id: string; used_at?: Date | string | null; expires_at: Date | string };

const toIso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

/** Invitation state from the newest invitation, or `used` as soon as any was used. */
export function describeInvites(
  invites: readonly InviteRow[],
  now: Date = new Date()
): { registered: boolean; invite_state: "pending" | "expired" | "used" | "none"; invite_expires_at: string | null } {
  if (invites.length === 0) {
    return { registered: false, invite_state: "none", invite_expires_at: null };
  }
  const newest = invites[0];
  if (invites.some((invite) => Boolean(invite.used_at))) {
    return { registered: true, invite_state: "used", invite_expires_at: toIso(newest.expires_at) };
  }
  const expired = new Date(newest.expires_at).getTime() <= now.getTime();
  return {
    registered: false,
    invite_state: expired ? "expired" : "pending",
    invite_expires_at: toIso(newest.expires_at),
  };
}

/** Loads users, invitations and locations for many vendors in three reads. */
async function assemble(container: MedusaContainer, vendors: VendorRow[]) {
  if (vendors.length === 0) {
    return [];
  }
  const vendorModule = getVendorModule(container);
  const vendorIds = vendors.map((vendor) => vendor.id);
  const users = await vendorModule.listVendorUsers({ vendor_id: vendorIds }, { take: null });
  const invites = users.length
    ? await vendorModule.listVendorInvites(
        { vendor_user_id: users.map((user) => user.id) },
        { take: null, order: { created_at: "DESC" } }
      )
    : [];
  const locations = await vendorModule.listVendorLocations(
    { vendor_id: vendorIds },
    { take: null, order: { code: "ASC" } }
  );

  return vendors.map((vendor) => {
    const user = users.find((candidate) => candidate.vendor_id === vendor.id);
    const userInvites = user ? invites.filter((invite) => invite.vendor_user_id === user.id) : [];
    const ownLocations = locations
      .filter((location) => location.vendor_id === vendor.id)
      .map((location) => toVendorLocationView(location));
    return {
      ...vendor,
      user: user ? { id: user.id, email: user.email, name: user.name, ...describeInvites(userInvites) } : null,
      locations: ownLocations,
      // The list view and the owner screens show this without loading locations.
      locations_count: ownLocations.length,
    };
  });
}

/** Full view of one vendor, with onboarding steps and the eligibility flag. */
export async function toAdminVendorView(
  container: MedusaContainer,
  vendor: VendorRow
): Promise<Record<string, unknown>> {
  const [assembled] = await assemble(container, [vendor]);
  const [steps, eligibility] = await Promise.all([
    getOnboardingSteps(container, { id: vendor.id, status: vendor.status }),
    getVendorEligibility(container, vendor.id),
  ]);
  return adminVendorSerializer.serialize({
    ...assembled,
    onboarding_steps: steps,
    eligible_to_list: eligibility.eligible,
  }) as Record<string, unknown>;
}

/** Lighter view for lists. No onboarding steps and no eligibility flag; `locations_count` is carried. */
export async function toAdminVendorListItems(
  container: MedusaContainer,
  vendors: VendorRow[]
): Promise<Record<string, unknown>[]> {
  const assembled = await assemble(container, vendors);
  return assembled.map((item) => adminVendorSerializer.serialize(item) as Record<string, unknown>);
}

export async function toAdminVendorListItem(
  container: MedusaContainer,
  vendor: VendorRow
): Promise<Record<string, unknown>> {
  const [item] = await toAdminVendorListItems(container, [vendor]);
  return item;
}
