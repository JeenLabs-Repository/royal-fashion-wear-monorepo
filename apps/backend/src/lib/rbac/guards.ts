// Guards: extra checks a manifest rule can ask for, run after the permission
// check passed so a caller without permission learns nothing about targets.
//
// protect-staff-target keeps two promises:
// - the break-glass account cannot be changed or deleted through any route;
// - at least one non-break-glass superadmin always remains.
//
// The delete route belongs to core, which runs after this middleware, so a
// plain read-then-act check would race a role revocation or a second delete.
// For DELETE /admin/users/:id the guard therefore takes the shared
// staff-assignments lock before it counts and keeps it until the response has
// finished. The assign and revoke workflows take the same key.

import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access";
import { extractParams, type ManifestRule } from "./match-manifest";
import { GUARD_NAMES, type GuardName } from "./permission-manifest";
import { adminLocals, getLogger, rejectRequest, type AdminRequest } from "./reject";

export const STAFF_ASSIGNMENTS_LOCK_KEY = "staff-access:assignments";

/** Tunable so tests do not wait ten seconds. */
export const LOCK_SETTINGS = { timeoutMs: 10_000, pollMs: 100, expireSeconds: 30 };

type Assignment = { user_id: string; role_key: string; is_break_glass: boolean };

type StaffAccessApi = {
  listStaffAssignments(
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<Assignment[]>;
  countNonBreakGlassSuperadmins(existingUserIds: string[]): Promise<number>;
};

type LockingApi = {
  acquire(keys: string[], args: { expire: number; ownerId: string }): Promise<unknown>;
  release(keys: string[], args: { ownerId: string }): Promise<unknown>;
};

export type GuardContext = {
  req: AdminRequest;
  res: MedusaResponse;
  params: Record<string, string>;
  rule: ManifestRule;
};

/** Resolves true to continue. A guard that answers the request resolves false. */
export type Guard = (context: GuardContext) => Promise<boolean>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function acquireLock(locking: LockingApi, ownerId: string): Promise<boolean> {
  const stopAt = Date.now() + LOCK_SETTINGS.timeoutMs;
  for (;;) {
    try {
      await locking.acquire([STAFF_ASSIGNMENTS_LOCK_KEY], {
        expire: LOCK_SETTINGS.expireSeconds,
        ownerId,
      });
      return true;
    } catch {
      if (Date.now() >= stopAt) {
        return false;
      }
      await sleep(LOCK_SETTINGS.pollMs);
    }
  }
}

function releaseWhenFinished(
  req: AdminRequest,
  res: MedusaResponse,
  locking: LockingApi,
  ownerId: string
): void {
  let released = false;
  const release = async () => {
    if (released) {
      return;
    }
    released = true;
    try {
      await locking.release([STAFF_ASSIGNMENTS_LOCK_KEY], { ownerId });
    } catch (error) {
      getLogger(req).error(
        `[staff-guard] lock release failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  // Release on both events; the lock expiry is the backstop if neither fires.
  res.once("finish", () => void release());
  res.once("close", () => void release());
}

const protectStaffTarget: Guard = async ({ req, res, params, rule }) => {
  const targetId = params.id ?? params.user_id;
  if (!targetId) {
    return true;
  }

  const staff = req.scope.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);
  const targetAssignments = await staff.listStaffAssignments({ user_id: targetId }, { take: null });

  if (targetAssignments.some((assignment) => assignment.is_break_glass)) {
    rejectRequest(res, {
      status: 403,
      code: "break_glass_protected",
      message:
        "This account is protected and cannot be changed here. Use the server command line to rotate it.",
    });
    return false;
  }

  const deletesUser = req.method.toUpperCase() === "DELETE" && rule.pattern.startsWith("/admin/users");
  if (!deletesUser) {
    return true;
  }

  const locking = req.scope.resolve<LockingApi>(Modules.LOCKING);
  const ownerId = adminLocals(res).requestId ?? `delete-user-${targetId}`;
  if (!(await acquireLock(locking, ownerId))) {
    rejectRequest(res, {
      status: 503,
      code: "staff_lock_busy",
      type: "unexpected_state",
      message: "Another staff change is in progress. Try again in a moment.",
    });
    return false;
  }
  releaseWhenFinished(req, res, locking, ownerId);

  // Read only after the lock is held, so a delete that waited sees the result
  // of the one before it. Re-read the target: a role may have changed meanwhile.
  const current = await staff.listStaffAssignments({ user_id: targetId }, { take: null });
  if (!current.some((assignment) => assignment.role_key === "superadmin")) {
    return true;
  }

  const superadmins = await staff.listStaffAssignments(
    { role_key: "superadmin", is_break_glass: false },
    { take: null }
  );
  const candidateIds = [...new Set(superadmins.map((row) => row.user_id))].filter(
    (id) => id !== targetId
  );
  const users = req.scope.resolve<IUserModuleService>(Modules.USER);
  const existing = candidateIds.length
    ? (await users.listUsers({ id: candidateIds }, { select: ["id"], take: null })).map((u) => u.id)
    : [];
  const remaining = await staff.countNonBreakGlassSuperadmins(existing);

  if (remaining === 0) {
    rejectRequest(res, {
      status: 409,
      code: "last_superadmin",
      type: "conflict",
      message: "This is the last superadmin. Make another user a superadmin first.",
    });
    return false;
  }
  return true;
};

export const GUARD_REGISTRY: Record<GuardName, Guard> = {
  "protect-staff-target": protectStaffTarget,
};

export async function runGuards(
  req: AdminRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const locals = adminLocals(res);
  const route = locals.adminRoute;
  const rule = route?.rule;
  const names = rule?.guards ?? [];

  for (const name of names) {
    const guard = (GUARD_REGISTRY as Record<string, Guard | undefined>)[name];
    if (!guard || !(GUARD_NAMES as readonly string[]).includes(name)) {
      rejectRequest(res, {
        status: 500,
        code: "guard_missing",
        type: "unexpected_state",
        message: "Could not check this request. Try again.",
      });
      return;
    }
    const params = extractParams(rule!.pattern, route!.casePath);
    const proceed = await guard({ req, res, params, rule: rule! });
    if (!proceed) {
      return;
    }
  }
  next();
}
