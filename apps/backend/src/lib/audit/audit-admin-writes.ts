// Records admin requests in the audit table when the response has finished.
//
// What is recorded: every request that is not a plain read (POST, DELETE, PUT,
// PATCH), every refusal, and every request of the break-glass account including
// reads. What is stored about a request is key names only, never values, so a
// password or a token in a body cannot reach an append-only table.
//
// A route that bypasses the permission steps (the invite accept route, which
// creates a staff user) is still recorded, from whatever identity the
// authentication step attached by the time the response finishes. A request
// with no identity at all is not recorded, so anonymous traffic cannot flood
// the table. Preflight requests (OPTIONS) change nothing and are skipped.
//
// Spike S1: with authenticate in the chain without allowUnregistered,
// auth_context is not reachable at finish on POST /admin/invites/accept.
// This writer runs on the core-handled bypass path instead, and reads
// req.auth_context at finish when core has attached it; with no context
// (anonymous 401) nothing is written.
//

import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { extractParams } from "../rbac/match-manifest";
import { adminLocals, getLogger, type AdminRequest } from "../rbac/reject";
import { extractKeyPaths } from "./redact";
import { recordAuditSafe } from "./record-audit";

const KNOWN_ACTOR_TYPES = ["user", "vendor", "customer"] as const;
type ActorType = (typeof KNOWN_ACTOR_TYPES)[number] | "system";

export function armAuditOnFinish(req: AdminRequest, res: MedusaResponse): void {
  const locals = adminLocals(res);
  if (locals.auditArmed) {
    return;
  }
  locals.auditArmed = true;
  res.on("finish", () => {
    void writeEntry(req, res);
  });
}

export function auditAdminWrites(
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  armAuditOnFinish(req, res);
  next();
}

async function writeEntry(req: AdminRequest, res: MedusaResponse): Promise<void> {
  try {
    const locals = adminLocals(res);
    if (locals.staffChainBypassReason === "options") {
      return;
    }
    const auth = req.auth_context;
    if (!auth) {
      return;
    }

    const staff = locals.staff;
    const denial = locals.adminDenied;
    const method = String(req.method).toUpperCase();
    const isRead = method === "GET" || method === "HEAD";
    if (!denial && isRead && !staff?.isBreakGlass) {
      return;
    }

    const action = denial ? "admin.denied" : isRead ? "admin.read" : "admin.write";
    const rawActorType = auth.actor_type ?? "user";
    const actorType: ActorType = (KNOWN_ACTOR_TYPES as readonly string[]).includes(rawActorType)
      ? (rawActorType as ActorType)
      : "system";

    const route = locals.adminRoute;
    const rule = route?.rule ?? null;
    const casePathSegments = (route?.casePath ?? "").split("/").filter(Boolean);
    const paramValues = rule ? Object.values(extractParams(rule.pattern, route!.casePath)) : [];
    const forwarded = req.headers["x-forwarded-for"];
    const firstHop = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    const userAgent = req.headers["user-agent"];

    await recordAuditSafe(req.scope, {
      action,
      actor: {
        id: auth.actor_id ? auth.actor_id : null,
        type: actorType,
        // Only a request that passed the staff context step has a confirmed user.
        label: staff ? await emailOf(req, auth.actor_id) : null,
        roles: staff?.roleKeys ?? [],
      },
      target: { type: casePathSegments[1] ?? null, id: paramValues[0] ?? null },
      http: {
        method,
        path: String(req.originalUrl ?? req.url ?? "").split("?")[0].slice(0, 500),
        route: rule ? rule.pattern : "unmatched",
        status: res.statusCode,
      },
      ip: req.ip,
      forwardedFor: firstHop || undefined,
      userAgent: typeof userAgent === "string" ? userAgent : undefined,
      requestId: locals.requestId,
      meta: {
        body_keys: extractKeyPaths(req.body ?? {}),
        query_keys: Object.keys(req.query ?? {}).sort(),
        ...(denial ? { code: denial.code } : {}),
        ...(actorType === "system" ? { auth_actor_type: rawActorType } : {}),
      },
    } as never);
  } catch (error) {
    getLogger(req).error(
      `[audit] write failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function emailOf(req: AdminRequest, userId: string | undefined): Promise<string | null> {
  if (!userId) {
    return null;
  }
  try {
    const users = req.scope.resolve<IUserModuleService>(Modules.USER);
    const found = await users.listUsers({ id: [userId] }, { select: ["email"] });
    return found[0]?.email ?? null;
  } catch {
    return null;
  }
}
