import { sdk } from "./sdk";

export type VendorStatus = "invited" | "active" | "suspended";
export type InviteState = "pending" | "expired" | "used" | "none";

export type VendorListItem = {
  id: string;
  internal_name: string;
  contact_name: string;
  contact_email: string;
  status: VendorStatus;
  activated_at: string | null;
  created_at: string;
  locations_count?: number;
  locations?: unknown[];
};

export const locationCount = (vendor: VendorListItem): number =>
  vendor.locations_count ?? vendor.locations?.length ?? 0;

export type VendorLocation = {
  id: string;
  code: string;
  label: string;
  state_code: string;
  state_name: string;
  pin: string;
  address_1: string;
  address_2: string | null;
  city: string | null;
  pickup_contact_name: string;
  pickup_contact_phone: string;
  status: "active" | "inactive";
};

export type OnboardingStep = {
  key: string;
  title: string;
  required_for_activation: boolean;
  complete: boolean;
};

export type VendorUserView = {
  id: string;
  email: string;
  name: string | null;
  registered: boolean;
  invite_state: InviteState;
  invite_expires_at: string | null;
};

export type VendorDetail = VendorListItem & {
  suspended_at: string | null;
  suspend_reason: string | null;
  note: string | null;
  eligible_to_list: boolean;
  user: VendorUserView | null;
  locations: VendorLocation[];
  onboarding_steps: OnboardingStep[];
};

export type CoverageEntry = {
  state_code: string;
  state_name: string;
  active_vendor_count: number;
  single_vendor: boolean;
};

export type VendorSection = { key: string; title: string; path: string };

export type InviteResult = { expires_at: string | null; email_sent: boolean };

export type ListParams = {
  status?: VendorStatus;
  q?: string;
  limit: number;
  offset: number;
};

export type ListResponse = {
  vendors: VendorListItem[];
  count: number;
  limit: number;
  offset: number;
  warnings: string[];
};

export type InviteBody = {
  internal_name: string;
  contact_name: string;
  contact_email: string;
  note?: string;
};

export type LocationBody = {
  label: string;
  state_code: string;
  pin: string;
  address_1: string;
  address_2?: string;
  city?: string;
  pickup_contact_name: string;
  pickup_contact_phone: string;
  status?: "active" | "inactive";
};

export const vendorKeys = {
  all: ["vendors"] as const,
  list: (params: ListParams) => ["vendors", "list", params] as const,
  detail: (id: string) => ["vendors", "detail", id] as const,
  coverage: ["vendors", "coverage"] as const,
  sections: (id: string) => ["vendors", "sections", id] as const,
};

// Paths live in constants so every call goes through the SDK client.
const BASE = "/admin/vendors";
const vendorPath = (id: string) => `${BASE}/${encodeURIComponent(id)}`;
const locationsPath = (id: string) => `${vendorPath(id)}/locations`;

export const listVendors = (params: ListParams) =>
  sdk.client.fetch<ListResponse>(BASE, {
    query: {
      limit: params.limit,
      offset: params.offset,
      ...(params.status ? { status: params.status } : {}),
      ...(params.q ? { q: params.q } : {}),
    },
  });

export const getVendor = (id: string) =>
  sdk.client.fetch<{ vendor: VendorDetail }>(vendorPath(id));

export const getStateCoverage = () =>
  sdk.client.fetch<{ states: CoverageEntry[] }>(`${BASE}/state-coverage`);

export const getVendorSections = (id: string) =>
  sdk.client.fetch<{ sections: VendorSection[] }>(`${vendorPath(id)}/sections`);

export const inviteVendor = (body: InviteBody) =>
  sdk.client.fetch<{ vendor: VendorListItem; invite: InviteResult }>(BASE, {
    method: "POST",
    body,
  });

export const resendInvite = (id: string) =>
  sdk.client.fetch<{ vendor: VendorListItem; invite: InviteResult }>(
    `${vendorPath(id)}/resend-invite`,
    { method: "POST", body: {} }
  );

export const activateVendor = (id: string) =>
  sdk.client.fetch<{ vendor: VendorDetail }>(`${vendorPath(id)}/activate`, {
    method: "POST",
    body: {},
  });

export const suspendVendor = (id: string, reason: string) =>
  sdk.client.fetch<{ vendor: VendorDetail }>(`${vendorPath(id)}/suspend`, {
    method: "POST",
    body: { reason },
  });

export const reactivateVendor = (id: string, reason: string) =>
  sdk.client.fetch<{ vendor: VendorDetail }>(`${vendorPath(id)}/reactivate`, {
    method: "POST",
    body: { reason },
  });

export const createLocation = (id: string, body: LocationBody) =>
  sdk.client.fetch<{ location: VendorLocation }>(locationsPath(id), {
    method: "POST",
    body,
  });

export const updateLocation = (id: string, locationId: string, body: Partial<LocationBody>) =>
  sdk.client.fetch<{ location: VendorLocation }>(
    `${locationsPath(id)}/${encodeURIComponent(locationId)}`,
    { method: "POST", body }
  );

export const isForbidden = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  (error as { status?: number }).status === 403;

export const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  (error as { status?: number }).status === 404;

// The server message is shown as it is, because blocking messages are written for staff.
export const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "Something went wrong. Try again.";

export const formatDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString() : "Not yet";

// A section path is a relative admin path. Reject anything else before it becomes a link.
export const isSafeSectionPath = (value: string): boolean =>
  /^\/(?!\/)[^\s\\]*$/.test(value) && !value.split("/").includes("..");
