import { ROLE_DEFINITIONS } from "../../lib/rbac/permissions";
import { sdk } from "./client";

export type StaffRole = { key: string; label: string };

export const ROLE_OPTIONS: StaffRole[] = ROLE_DEFINITIONS.map((role) => ({
  key: role.key as string,
  label: role.label as string,
}));

export const roleLabel = (key: string): string =>
  ROLE_OPTIONS.find((role) => role.key === key)?.label ?? key;

export type StaffMe = {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  roles: string[];
  permissions: string[];
  is_break_glass: boolean;
  access: "granted" | "no_role";
  mfa_enabled: boolean;
};

export type StaffRow = {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  roles: string[];
  is_break_glass: boolean;
  mfa_state: "enrolled" | "not_enrolled" | "unknown";
};

export type StaffListResponse = {
  staff: StaffRow[];
  count: number;
  limit: number;
  offset: number;
};

export type BreakGlassReview = {
  id: string;
  opened_at: string;
  first_ip: string | null;
  first_request: string | null;
  closed_at: string | null;
  closed_by: string | null;
  rotated_confirmed: boolean;
  note: string | null;
  age_hours: number;
};

export type RolesResponse = { user_id: string; roles: string[] };

export const staffKeys = {
  me: ["staff", "me"],
  list: ["staff", "list"],
  openReviews: ["staff", "reviews", "open"],
} as const;

// Paths live in constants so every call goes through the SDK client.
const PATHS = {
  me: "/admin/staff/me",
  list: "/admin/staff",
  reviews: "/admin/staff/break-glass-reviews",
} as const;

const rolesPath = (userId: string) => `/admin/staff/${encodeURIComponent(userId)}/roles`;
const rolePath = (userId: string, role: string) =>
  `${rolesPath(userId)}/${encodeURIComponent(role)}`;
const closePath = (reviewId: string) =>
  `${PATHS.reviews}/${encodeURIComponent(reviewId)}/close`;

export const fetchMe = () => sdk.client.fetch<StaffMe>(PATHS.me);

export const fetchStaff = () => sdk.client.fetch<StaffListResponse>(PATHS.list);

export const fetchOpenReviews = () =>
  sdk.client.fetch<{ reviews: BreakGlassReview[] }>(PATHS.reviews, {
    query: { status: "open" },
  });

export const assignRole = (userId: string, role: string) =>
  sdk.client.fetch<RolesResponse>(rolesPath(userId), {
    method: "POST",
    body: { role },
  });

export const revokeRole = (userId: string, role: string) =>
  sdk.client.fetch<RolesResponse>(rolePath(userId, role), { method: "DELETE" });

export const closeReview = (
  reviewId: string,
  input: { rotated_confirmed: true; note: string }
) =>
  sdk.client.fetch<{ review: BreakGlassReview }>(closePath(reviewId), {
    method: "POST",
    body: input,
  });

export const isForbidden = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  (error as { status?: number }).status === 403;

export const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "Something went wrong.";
