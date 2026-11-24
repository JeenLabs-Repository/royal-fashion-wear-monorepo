import type { LoaderOptions } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ROLE_DEFINITIONS } from "../../../lib/rbac/permissions";
import { STAFF_ACCESS_MODULE } from "../constants";
import StaffAccessModuleService from "../service";
import type { SyncRolesResult } from "../service";

type Resolver = {
  resolve: (key: string) => unknown;
  cradle?: Record<string, unknown>;
  registrations?: Record<string, unknown>;
};
type LogLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// Application container (scripts): module name. Module local container during
// loaders: the module service is not registered yet; construct from cradle.
const SERVICE_KEYS = [STAFF_ACCESS_MODULE, "moduleService"];

const tryResolve = (container: Resolver, keys: string[]): unknown => {
  for (const key of keys) {
    try {
      const value = container.resolve(key);
      if (value) {
        return value;
      }
    } catch {
      // try the next key
    }
  }
  return undefined;
};

const tryResolveService = (
  container: Resolver,
  keys: string[]
): StaffAccessModuleService | undefined => {
  for (const key of keys) {
    try {
      const value = container.resolve(key) as StaffAccessModuleService | undefined;
      if (value && typeof value.syncRoles === "function") {
        return value;
      }
    } catch {
      // try the next key
    }
  }
  return undefined;
};

const serviceFromCradle = (
  container: Resolver
): StaffAccessModuleService | undefined => {
  const cradle = container.cradle;
  if (!cradle?.baseRepository) {
    return undefined;
  }
  try {
    return new StaffAccessModuleService(cradle);
  } catch {
    return undefined;
  }
};

/**
 * Writes the roles from code into the database. Never throws: a missing table
 * before the first migration must not stop the migrate command. Returns null
 * when the sync did not run.
 */
export async function syncStaffRoles(
  container: Resolver
): Promise<SyncRolesResult | null> {
  const logger = tryResolve(container, [ContainerRegistrationKeys.LOGGER]) as
    | LogLike
    | undefined;
  try {
    const service =
      tryResolveService(container, SERVICE_KEYS) ?? serviceFromCradle(container);
    if (!service) {
      const keys = container.registrations
        ? Object.keys(container.registrations).sort().join(",")
        : "unknown";
      throw new Error(
        `staff access service is not registered (keys: ${keys})`
      );
    }
    const result = await service.syncRoles(ROLE_DEFINITIONS);
    logger?.info(`[staff-access] roles synced: ${ROLE_DEFINITIONS.length}`);
    if (result.stale.length) {
      logger?.warn(
        `[staff-access] roles in the database but not in code (kept): ${result.stale.join(", ")}`
      );
    }
    return result;
  } catch (error) {
    logger?.error(
      `[staff-access] role sync failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

export default async function syncRolesLoader({ container }: LoaderOptions) {
  await syncStaffRoles(container as Resolver);
}
