import { authenticate } from "@medusajs/framework/http";
import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import { requireMfaEnrollment, type MfaAllowlistEntry } from "../mfa";
import { adminLocals, type AdminHandler, type AdminRequest } from "../rbac/reject";
import { armVendorAuditOnFinish, auditVendorWrites } from "./audit-vendor-writes";
import { vendorStatusGuard } from "./status-guard";

/**
 * What a vendor that has not enrolled in two-step sign-in may still call. The
 * sign-in and enrolment endpoints all live under /auth, which includes the
 * /auth/mfa endpoints, and the two reads the portal makes to show who is
 * signed in and what is left to do.
 */
export const VENDOR_MFA_ALLOWLIST: readonly MfaAllowlistEntry[] = [
  { method: "*", pattern: "/auth*" },
  { method: "GET", pattern: "/vendor/me" },
  { method: "GET", pattern: "/vendor/onboarding" },
];

/**
 * Lets a refusal further down the chain arm the audit writer, so a denied
 * write is recorded as well as an allowed one.
 */
export function initVendorRequest(
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  adminLocals(res).armAudit = () => armVendorAuditOnFinish(req, res);
  next();
}

/**
 * The vendor request chain, in order. A plugin that mounts its own vendor
 * routes elsewhere reuses this array. Routes under /vendor get it from the
 * middleware entries.
 */
export const authenticateVendor: AdminHandler[] = [
  // The vendor actor only. Admin and customer tokens are refused here.
  authenticate("vendor", ["session", "bearer"]) as unknown as AdminHandler,
  initVendorRequest,
  requireMfaEnrollment("vendor", { allowlist: VENDOR_MFA_ALLOWLIST }),
  vendorStatusGuard,
  auditVendorWrites,
];
