// Raises the alarm when the break-glass account is used.
//
// The first authenticated request by that account in any 15-minute window
// (a) logs an ERROR line, (b) opens a review row if none is open, (c) writes the
// break_glass.used audit entry and (d) emails the alert recipients. A failure
// anywhere in this step is logged and the request continues: a broken alert
// must never lock the owner out, and the log line and the audit row remain as
// the fallbacks until other alert channels exist.
//
// Every request of the account, including reads, is recorded by the finish
// writer in the audit module; this step only handles the alert.

import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { buildIdempotencyKey, sendTemplatedEmail } from "../../emails/lib/send-email";
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access";
import { recordAuditSafe } from "../audit/record-audit";
import { adminLocals, getLogger, type AdminRequest } from "../rbac/reject";
import { tryOpenAlertWindow } from "./alert-window";
import { getBreakGlassAlertRecipients } from "./parse-alert-emails";
import { formatIst } from "./time";

type StaffAccessApi = {
  createBreakGlassReviews(rows: Array<Record<string, unknown>>): Promise<unknown>;
};

// A second window while a review is still open hits IDX_break_glass_review_open_unique
// (and the named constraint break_glass_review_open_unique).
const UNIQUE_VIOLATION = /duplicate key|unique constraint|IDX_[a-z0-9_]*break_glass|break_glass_review_open_unique/i;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function breakGlassWatch(
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const staff = adminLocals(res).staff;
  if (!staff?.isBreakGlass) {
    next();
    return;
  }
  try {
    await handleBreakGlassUse(req, res, staff.userId);
  } catch (error) {
    getLogger(req).error(`[break-glass] alert step failed: ${messageOf(error)}`);
  }
  next();
}

export async function handleBreakGlassUse(
  req: AdminRequest,
  res: MedusaResponse,
  userId: string,
  now: Date = new Date()
): Promise<void> {
  const { opened, bucket } = await tryOpenAlertWindow(req.scope, userId, now.getTime());
  if (!opened) {
    return;
  }

  const logger = getLogger(req);
  const locals = adminLocals(res);
  const route = locals.adminRoute?.rule?.pattern ?? "unmatched";
  const method = String(req.method).toUpperCase();
  const ip = req.ip ?? "unknown";
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedFor = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();

  // (a) No emails, tokens or request values in this line.
  logger.error(`[break-glass] USED actor=${userId} ip=${ip} method=${method} route=${route}`);

  // (b) One open review per account; an existing open review is fine.
  try {
    await req.scope.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE).createBreakGlassReviews([
      {
        opened_at: now,
        actor_user_id: userId,
        window_key: String(bucket),
        first_ip: ip,
        first_request: `${method} ${route}`,
      },
    ]);
  } catch (error) {
    if (!UNIQUE_VIOLATION.test(messageOf(error))) {
      throw error;
    }
  }

  // (c) The audit row of the use itself.
  await recordAuditSafe(req.scope, {
    action: "break_glass.used",
    actor: { id: userId, type: "user", label: await emailOf(req, userId), roles: ["superadmin"] },
    target: { type: "user", id: userId },
    ip: req.ip,
    forwardedFor: forwardedFor || undefined,
    requestId: locals.requestId,
    meta: { bucket },
  });

  // (d) The email is started without waiting, so mail latency never delays the request.
  const recipients = getBreakGlassAlertRecipients(process.env);
  if (recipients.length === 0) {
    logger.warn("[break-glass] no valid BREAK_GLASS_ALERT_EMAILS configured, no alert email sent");
    return;
  }
  const adminUrl = (process.env.ADMIN_APP_URL || "http://localhost:9000/app").replace(/\/+$/, "");
  void sendTemplatedEmail({
    container: req.scope,
    template: "break-glass-used",
    to: recipients,
    props: {
      whenUtc: now.toISOString(),
      whenIst: formatIst(now),
      ip,
      forwardedFor: forwardedFor || undefined,
      method,
      route,
      reviewUrl: `${adminUrl}/staff`,
    },
    idempotencyKey: buildIdempotencyKey("break-glass-used", userId, String(bucket)),
    tag: "break-glass",
  }).catch((error: unknown) => {
    logger.error(`[break-glass] alert email failed: ${messageOf(error)}`);
  });
}

async function emailOf(req: AdminRequest, userId: string): Promise<string | null> {
  try {
    const users = req.scope.resolve<IUserModuleService>(Modules.USER);
    return (await users.listUsers({ id: [userId] }, { select: ["email"] }))[0]?.email ?? null;
  } catch {
    return null;
  }
}
