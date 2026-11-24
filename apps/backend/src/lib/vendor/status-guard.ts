import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import { normalizeAdminPath, normalizeMethod } from "../rbac/normalize-path";
import { rejectRequest, type AdminRequest } from "../rbac/reject";
import type { VendorContext } from "./vendor-context";
import { getVendorModule } from "./vendor-module";

export const SUSPENDED_MESSAGE = "Your account is suspended. Contact the store.";
export const NOT_ACTIVE_MESSAGE = "Your account is waiting for activation by the store.";

export type VendorAccessDecision =
  | { allow: true }
  | {
      allow: false;
      code: "vendor_suspended" | "vendor_not_active";
      message: string;
    };

type OnboardingRoute = {
  /** Upper-case methods, or `*` for every method. */
  methods: readonly string[];
  /** Lower-case path. */
  path: string;
  /** True when the path also covers everything below it. */
  prefix?: boolean;
};

/**
 * The only routes a vendor that is not active yet may call. A new vendor route
 * is refused to an invited vendor until its path is added here on purpose.
 */
export const ONBOARDING_ROUTES: readonly OnboardingRoute[] = [
  { methods: ["GET"], path: "/vendor/me" },
  { methods: ["GET"], path: "/vendor/me/locations" },
  { methods: ["GET"], path: "/vendor/onboarding" },
  // An invited vendor sets a password here before activation. The route itself
  // is added by the credentials work. Path from the actor-mechanics record.
  { methods: ["POST"], path: "/vendor/me/password" },
  { methods: ["*"], path: "/vendor/agreement", prefix: true },
];

const isOnboardingRoute = (method: string, matchPath: string): boolean =>
  ONBOARDING_ROUTES.some(
    (route) =>
      (route.methods.includes("*") || route.methods.includes(method)) &&
      (matchPath === route.path || (route.prefix === true && matchPath.startsWith(`${route.path}/`)))
  );

/**
 * Pure access rule. A trailing slash and a query string do not change the
 * result. Anything that is not clearly active or suspended is treated as not
 * active, so an unknown status never gains access.
 */
export function evaluateVendorAccess(
  status: string,
  method: string,
  path: string
): VendorAccessDecision {
  if (status === "active") {
    return { allow: true };
  }
  if (status === "suspended") {
    return { allow: false, code: "vendor_suspended", message: SUSPENDED_MESSAGE };
  }
  const normalized = normalizeAdminPath(path);
  if (normalized.ok && isOnboardingRoute(normalizeMethod(method), normalized.matchPath)) {
    return { allow: true };
  }
  return { allow: false, code: "vendor_not_active", message: NOT_ACTIVE_MESSAGE };
}

type RequestWithVendor = AdminRequest & { vendor?: VendorContext };

const unauthorized = (res: MedusaResponse) =>
  rejectRequest(res, {
    status: 401,
    code: "unauthorized",
    type: "unauthorized",
    message: "Unauthorized",
  });

/**
 * Loads the vendor user and then the vendor from the module on every request
 * and decides from what it finds. Nothing is remembered between requests, so a
 * suspension applies on the very next call. The vendor id comes from the actor
 * id through the vendor user, never from the request.
 */
export async function vendorStatusGuard(
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  try {
    const actorId = req.auth_context?.actor_id;
    if (!actorId) {
      unauthorized(res);
      return;
    }

    const vendorModule = getVendorModule(req.scope);
    const [user] = await vendorModule.listVendorUsers({ id: actorId }, { take: 1 });
    const [vendor] = user
      ? await vendorModule.listVendors({ id: user.vendor_id }, { take: 1 })
      : [];
    if (!user || !vendor) {
      unauthorized(res);
      return;
    }

    (req as RequestWithVendor).vendor = {
      id: vendor.id,
      user_id: user.id,
      user_email: user.email,
      status: vendor.status as VendorContext["status"],
      internal_name: vendor.internal_name,
    };

    const decision = evaluateVendorAccess(
      vendor.status,
      req.method,
      req.originalUrl ?? req.url ?? ""
    );
    if (!decision.allow) {
      rejectRequest(res, { status: 403, code: decision.code, message: decision.message });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
