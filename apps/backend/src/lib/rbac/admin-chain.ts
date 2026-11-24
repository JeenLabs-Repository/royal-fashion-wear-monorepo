// The middleware chain every /admin request runs through, in this order:
//
//   init            request id, path normalisation, rule lookup, bypass flags
//   authenticate    Medusa's own authenticate, called here (not left to core ordering)
//   refuse-api-key  secret API keys are refused on every admin route
//   mfa-gate        a user who never enrolled in two-step sign-in is refused
//   staff-context   the user must still exist; roles are read fresh, never cached
//   permission      the manifest rule decides; no rule means superadmin only
//   guards          rule-specific checks (protect the break-glass account)
//   audit           records the request when the response finishes
//
// Two kinds of request skip the middle steps: OPTIONS preflights (no handler
// runs) and routes marked core-handled in the manifest (core authenticates
// them). The audit step still runs for the second kind.
//
// Every step fails closed: an error inside a step never lets the request
// continue to the route.

import { authenticate } from "@medusajs/framework/http";
import type {
  MedusaNextFunction,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { randomUUID } from "node:crypto";
import { armAuditOnFinish, auditAdminWrites } from "../audit/audit-admin-writes";
import { STAFF_MFA_ALLOWLIST } from "../mfa";
import { requireMfaEnrollment } from "../mfa/require-mfa-enrollment";
import { runGuards } from "./guards";
import { resolveRule } from "./match-manifest";
import { normalizeAdminPath, normalizeMethod } from "./normalize-path";
import { PERMISSION_MANIFEST } from "./permission-manifest";
import { refuseApiKeyActors } from "./refuse-api-key";
import { requireManifestPermission } from "./require-permission";
import { loadStaffContext } from "./staff-context";
import {
  adminLocals,
  rejectRequest,
  type AdminHandler,
  type AdminLocals,
  type AdminRequest,
} from "./reject";

export type { AdminLocals };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export type ChainStepOptions = { runWhenBypassed?: boolean };

/**
 * Wraps a step so it is skipped for bypassed requests (unless it opts in) and
 * so a thrown error goes to the error handler instead of the route.
 */
export function chainStep(
  handler: AdminHandler,
  options: ChainStepOptions = {}
): AdminHandler {
  return async (req, res, next) => {
    if (adminLocals(res).staffChainBypass && !options.runWhenBypassed) {
      next();
      return;
    }
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function initAdminRequest(
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  const locals = adminLocals(res);

  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  locals.armAudit = () => armAuditOnFinish(req, res);

  const path = normalizeAdminPath(req.originalUrl ?? req.url ?? "");
  if (!path.ok) {
    rejectRequest(res, {
      status: 400,
      code: "invalid_path",
      type: "invalid_data",
      message: "The request path is not valid.",
    });
    return;
  }

  applyTrustProxy(req);

  const method = normalizeMethod(req.method);
  const resolved = resolveRule(PERMISSION_MANIFEST, method, path.matchPath);
  locals.adminRoute = {
    matchPath: path.matchPath,
    casePath: path.casePath,
    rule: resolved ? resolved.rule : null,
  };

  if (method === "OPTIONS") {
    // The CORS layer answers preflights and no handler runs.
    locals.staffChainBypass = true;
    locals.staffChainBypassReason = "options";
  } else if (resolved?.rule.permission === "core-handled") {
    locals.staffChainBypass = true;
    locals.staffChainBypassReason = "core-handled";
  }
  next();
}

/** Parses TRUST_PROXY_HOPS: a non-negative integer, 0 when unset. A typo must not silently disable it. */
export function readTrustProxyHops(env: Record<string, string | undefined>): number {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") {
    return 0;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "TRUST_PROXY_HOPS must be a non-negative whole number"
    );
  }
  return Number(raw.trim());
}

// Read once at load so a bad value stops the backend from starting.
const TRUST_PROXY_HOPS = readTrustProxyHops(process.env);
let trustProxyApplied = false;
function applyTrustProxy(req: AdminRequest): void {
  // Always apply, including 0: the framework boots with trust proxy 1, and a
  // development value of 0 must override that or req.ip follows the header.
  if (trustProxyApplied) {
    return;
  }
  trustProxyApplied = true;
  (req as unknown as { app?: { set(name: string, value: unknown): void } }).app?.set(
    "trust proxy",
    TRUST_PROXY_HOPS
  );
}

// The matcher form for /admin*.
export const ADMIN_MATCHER = "/admin*";

type StepDefinition = {
  name: string;
  handler: AdminHandler;
  options?: ChainStepOptions;
};

export const ADMIN_CHAIN_STEPS: StepDefinition[] = [
  { name: "init", handler: initAdminRequest, options: { runWhenBypassed: true } },
  {
    name: "authenticate",
    handler: authenticate("user", ["session", "bearer", "api-key"]) as AdminHandler,
  },
  { name: "refuse-api-key", handler: refuseApiKeyActors },
  {
    name: "mfa-gate",
    handler: requireMfaEnrollment("user", { allowlist: STAFF_MFA_ALLOWLIST }),
  },
  { name: "staff-context", handler: loadStaffContext },
  { name: "permission", handler: requireManifestPermission },
  { name: "guards", handler: runGuards },
  { name: "audit", handler: auditAdminWrites, options: { runWhenBypassed: true } },
];

export const adminChain: AdminHandler[] = ADMIN_CHAIN_STEPS.map((step) =>
  chainStep(step.handler, step.options)
);

export const adminMiddlewareRoutes: MiddlewareRoute[] = [
  {
    matcher: ADMIN_MATCHER,
    middlewares: adminChain as unknown as MiddlewareRoute["middlewares"],
  },
];
