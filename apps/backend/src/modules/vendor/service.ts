import type { Context } from "@medusajs/framework/types";
import {
  InjectManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils";
import LocationCodeSeq from "./models/location-code-seq";
import Vendor from "./models/vendor";
import VendorAgreementAcceptance from "./models/vendor-agreement-acceptance";
import VendorInvite from "./models/vendor-invite";
import VendorLocation from "./models/vendor-location";
import VendorUser from "./models/vendor-user";
import { formatLocationCode } from "./utils/location-code";

// The manager Medusa injects is a MikroORM manager. Only what this file calls
// is typed, so a change in the package types cannot break the build here.
type SqlManager = {
  execute?: (sql: string, params?: unknown[]) => Promise<unknown>;
  getConnection?: () => {
    execute: (sql: string, params?: unknown[]) => Promise<unknown>;
  };
};

// <RESOLVE: confirm `manager.execute` exists on the injected manager. Command: print
// Object.getOwnPropertyNames(Object.getPrototypeOf(sharedContext.manager)) once from a module
// test. The fallback to getConnection().execute below covers the other known shape.>
const runSql = async (
  sharedContext: Context,
  sql: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> => {
  const manager = sharedContext.manager as unknown as SqlManager | undefined;
  if (!manager) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "No database manager in the module context."
    );
  }
  const result = manager.execute
    ? await manager.execute(sql, params)
    : await manager.getConnection!().execute(sql, params);
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }
  return ((result as { rows?: Record<string, unknown>[] } | undefined)?.rows ?? []);
};

const lowerEmail = (row: unknown): unknown => {
  if (row && typeof row === "object" && typeof (row as { email?: unknown }).email === "string") {
    return { ...(row as object), email: (row as { email: string }).email.trim().toLowerCase() };
  }
  return row;
};

const lowerEmails = (data: unknown): unknown => {
  if (Array.isArray(data)) {
    return data.map(lowerEmail);
  }
  // update forms: a row, a list of rows, or { selector, data }
  if (data && typeof data === "object" && "data" in (data as object)) {
    const form = data as { data?: unknown };
    return { ...(data as object), data: lowerEmail(form.data) };
  }
  return lowerEmail(data);
};

class VendorModuleService extends MedusaService({
  Vendor,
  VendorUser,
  VendorLocation,
  VendorInvite,
  VendorAgreementAcceptance,
  LocationCodeSeq,
}) {
  // No caller can store a mixed-case email: both write paths lower-case it here.
  // MedusaService generates these as instance properties, so they must be
  // overridden as properties (not methods) or the production build fails TS2425.
  createVendorUsers = async (...args: any[]): Promise<any> => {
    const [data, ...rest] = args;
    const parent = Object.getPrototypeOf(VendorModuleService.prototype) as {
      createVendorUsers: (...a: any[]) => Promise<any>;
    };
    return await parent.createVendorUsers.call(this, lowerEmails(data), ...rest);
  };

  updateVendorUsers = async (...args: any[]): Promise<any> => {
    const [data, ...rest] = args;
    const parent = Object.getPrototypeOf(VendorModuleService.prototype) as {
      updateVendorUsers: (...a: any[]) => Promise<any>;
    };
    return await parent.updateVendorUsers.call(this, lowerEmails(data), ...rest);
  };

  /**
   * Next location code. One statement: the upsert takes the row lock, so
   * concurrent callers are served one after another and never share a number.
   */
  @InjectManager()
  async allocateLocationCode(
    @MedusaContext() sharedContext: Context = {}
  ): Promise<string> {
    const rows = await runSql(
      sharedContext,
      `insert into location_code_seq (id, last_value) values ('default', 1)
       on conflict (id) do update set last_value = location_code_seq.last_value + 1, updated_at = now()
       returning last_value`
    );
    const value = Number(rows[0]?.last_value);
    return formatLocationCode(value);
  }

  /**
   * Uses an invitation exactly once. The single UPDATE is the whole check: it
   * matches only an unused, unexpired, undeleted row, so two simultaneous
   * callers cannot both get it.
   */
  @InjectManager()
  async consumeInviteToken(
    tokenHash: string,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<{ id: string; vendor_user_id: string } | null> {
    const rows = await runSql(
      sharedContext,
      `update vendor_invite set used_at = now()
       where token_hash = ? and used_at is null and expires_at > now() and deleted_at is null
       returning id, vendor_user_id`,
      [tokenHash]
    );
    if (!rows.length) {
      return null;
    }
    return {
      id: String(rows[0].id),
      vendor_user_id: String(rows[0].vendor_user_id),
    };
  }

  /** Undoes consumeInviteToken. Used only by workflow compensation. */
  @InjectManager()
  async releaseInviteToken(
    inviteId: string,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    await runSql(
      sharedContext,
      `update vendor_invite set used_at = null where id = ?`,
      [inviteId]
    );
  }
}

export default VendorModuleService;
