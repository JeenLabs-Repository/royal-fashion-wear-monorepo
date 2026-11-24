export {
  isMfaEnrolled,
  MFA_ENROLLMENT_MESSAGE,
  requireMfaEnrollment,
  type MfaAllowlistEntry,
  type RequireMfaOptions,
} from "./require-mfa-enrollment";

import type { MfaAllowlistEntry } from "./require-mfa-enrollment";

/**
 * What an unenrolled staff user may still call: the sign-in and factor
 * endpoints under /auth, and the two reads the dashboard makes to show who is
 * signed in, plus the dashboard shell GETs the Security screen needs while
 * enrolment is still open (layouts, modules, search indexes, notifications and
 * cloud announcements).
 */
export const STAFF_MFA_ALLOWLIST: readonly MfaAllowlistEntry[] = [
  { method: "*", pattern: "/auth*" },
  { method: "GET", pattern: "/admin/users/me" },
  { method: "GET", pattern: "/admin/staff/me" },
  { method: "GET", pattern: "/admin/layouts*" },
  { method: "GET", pattern: "/admin/modules" },
  { method: "GET", pattern: "/admin/search-indexes" },
  { method: "GET", pattern: "/admin/notifications*" },
  { method: "GET", pattern: "/admin/cloud/announcements*" },
];
