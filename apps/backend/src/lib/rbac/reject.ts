// Shared request and response types for the admin middleware chain, plus the
// one function every step uses to refuse a request.
//
// Every refusal has the same JSON shape, { type, code, message }, so a client
// (and a test) can rely on `code`. The message is plain and never names the
// rule that refused the request.

import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { ManifestRule } from "./match-manifest";

export type AuthContextLike = {
  actor_id?: string;
  actor_type?: string;
  auth_identity_id?: string;
  app_metadata?: Record<string, unknown>;
  mfa_enabled?: boolean;
};

export type AdminRequest = MedusaRequest & { auth_context?: AuthContextLike };

export type StaffLocals = {
  userId: string;
  roleKeys: string[];
  permissions: string[];
  isBreakGlass: boolean;
};

/** What the chain keeps in `res.locals` for the steps after it and for tests. */
export type AdminLocals = {
  requestId?: string;
  adminRoute?: { matchPath: string; casePath: string; rule: ManifestRule | null };
  staff?: StaffLocals;
  armAudit?: () => void;
  auditArmed?: boolean;
  staffChainBypass?: boolean;
  staffChainBypassReason?: "options" | "core-handled";
  adminDenied?: { code: string };
};

export type AdminHandler = (
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => void | Promise<void>;

export type LoggerLike = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export const adminLocals = (res: MedusaResponse): AdminLocals => res.locals as AdminLocals;

/** The Medusa logger, or the console when the scope cannot supply one. */
export function getLogger(req: AdminRequest): LoggerLike {
  try {
    return req.scope.resolve<LoggerLike>(ContainerRegistrationKeys.LOGGER);
  } catch {
    return console;
  }
}

export type RejectOptions = {
  status: number;
  code: string;
  message: string;
  /** Defaults to not_allowed. */
  type?: string;
};

export function rejectRequest(res: MedusaResponse, options: RejectOptions): void {
  const locals = adminLocals(res);
  if (typeof locals.armAudit === "function") {
    try {
      // Record the denial first; a failure to arm auditing never blocks the refusal.
      locals.armAudit();
    } catch {
      // The refusal below still goes out.
    }
  }
  locals.adminDenied = { code: options.code };
  res.status(options.status).json({
    type: options.type ?? "not_allowed",
    code: options.code,
    message: options.message,
  });
}
