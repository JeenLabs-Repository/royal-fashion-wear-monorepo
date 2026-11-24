// Forces enrolment in two-step sign-in (TOTP) before any protected route works.
//
// The auth module makes TOTP opt-in per identity, so nothing stops a user who
// never enrolled. This factory refuses every request from a caller of the given
// actor type whose auth context shows no enrolment, except a short allowlist
// that the enrolment screens themselves need.
//
// "Enrolled" means a verified TOTP factor plus generated recovery codes. The
// server can see the factor; whether the person saved the recovery codes is the
// dashboard's step and cannot be proven here.
//
// Nobody is exempt: the break-glass account passes through the same gate.
//
// The factory takes the actor type so another kind of user (a vendor) reuses it
// with its own allowlist.

import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import {
  resolveRule,
  type ManifestMethod,
  type ManifestRule,
} from "../rbac/match-manifest";
import { normalizeAdminPath, normalizeMethod } from "../rbac/normalize-path";
import { rejectRequest, type AdminRequest, type AuthContextLike } from "../rbac/reject";

export type MfaAllowlistEntry = { method: ManifestMethod | string; pattern: string };

export type RequireMfaOptions = {
  /** Requests the gate lets through for an unenrolled caller. `/auth*` is always allowed. */
  allowlist?: readonly MfaAllowlistEntry[];
};

/**
 * The one place that reads the enrolment flag, so its source can change without
 * touching the gate or its tests.
 */
export function isMfaEnrolled(authContext: AuthContextLike | undefined): boolean {
  return authContext?.mfa_enabled === true;
}

export const MFA_ENROLLMENT_MESSAGE =
  "Set up two-step sign-in under Profile > Security, then reload this page.";

export function requireMfaEnrollment(actorType: string, options: RequireMfaOptions = {}) {
  const entries: MfaAllowlistEntry[] = [
    { method: "*", pattern: "/auth*" },
    ...(options.allowlist ?? []),
  ];
  const rules: ManifestRule[] = entries.map((entry) => ({
    method: entry.method as ManifestMethod,
    pattern: entry.pattern,
    permission: "self",
  }));

  return function mfaGate(req: AdminRequest, res: MedusaResponse, next: MedusaNextFunction): void {
    const authContext = req.auth_context;
    if (!authContext || authContext.actor_type !== actorType) {
      next();
      return;
    }
    if (isMfaEnrolled(authContext)) {
      next();
      return;
    }

    const path = normalizeAdminPath(req.originalUrl ?? req.url ?? "");
    if (path.ok && resolveRule(rules, normalizeMethod(req.method), path.matchPath)) {
      next();
      return;
    }

    rejectRequest(res, {
      status: 403,
      code: "mfa_enrollment_required",
      message: MFA_ENROLLMENT_MESSAGE,
    });
  };
}
