import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import { recordAuditSafe } from "../audit";
import { adminLocals, type AdminRequest } from "../rbac/reject";
import type { VendorContext } from "./vendor-context";

// Records one audit entry when the response of a vendor write has finished.
// Only the NAMES of body properties are stored, never values, so a password or
// a token in a body cannot reach the append-only table. A refused request is
// recorded as well, with the refusal code. A failure to write is logged by the
// audit library and never changes the response.

type VendorAuditLocals = { vendorAuditArmed?: boolean };

const MAX_USER_AGENT = 200;

export function armVendorAuditOnFinish(req: AdminRequest, res: MedusaResponse): void {
  const locals = res.locals as VendorAuditLocals;
  if (locals.vendorAuditArmed) {
    return;
  }
  locals.vendorAuditArmed = true;
  res.on("finish", () => {
    void writeEntry(req, res);
  });
}

export function auditVendorWrites(
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  armVendorAuditOnFinish(req, res);
  next();
}

async function writeEntry(req: AdminRequest, res: MedusaResponse): Promise<void> {
  try {
    const method = String(req.method).toUpperCase();
    const denial = adminLocals(res).adminDenied;
    const isRead = method === "GET" || method === "HEAD" || method === "OPTIONS";
    if (method === "OPTIONS" || (isRead && !denial)) {
      return;
    }

    const vendor = (req as AdminRequest & { vendor?: VendorContext }).vendor;
    const actorId = vendor?.user_id ?? req.auth_context?.actor_id;
    if (!actorId) {
      return;
    }

    const route = String(req.originalUrl ?? req.url ?? "").split("?")[0].slice(0, 500);
    const userAgentHeader = req.headers["user-agent"];
    const userAgent =
      typeof userAgentHeader === "string" ? userAgentHeader.slice(0, MAX_USER_AGENT) : undefined;

    await recordAuditSafe(req.scope, {
      action: "vendor.request",
      actor: {
        id: actorId,
        type: "vendor",
        label: vendor?.user_email ?? null,
        roles: [],
      },
      target: { type: "vendor", id: vendor?.id ?? null },
      http: { method, path: route, route, status: res.statusCode },
      ip: req.ip,
      userAgent,
      meta: {
        http_method: method,
        http_route: route,
        http_status: res.statusCode,
        ip: req.ip ?? null,
        user_agent: userAgent ?? null,
        body_keys: Object.keys((req.body ?? {}) as Record<string, unknown>).sort(),
        ...(denial ? { denied_code: denial.code } : {}),
      },
    });
  } catch (error) {
    console.error(
      `[vendor-audit] write failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
