// The only file that knows how to call the Integration Module. Everything else
// in src/lib/settings goes through fetchResolvedOptions, so a change in the
// package or in what the module returns touches this file alone.
//
// Call and return shapes follow the integration card reader decision record:
// container.resolve(INTEGRATION_MODULE).getResolvedOptions(identifier, instanceId)
// returns { options, meta } | null. Null covers unsaved and disabled cards.
// An unknown identifier throws a registration error.

import {
  DEFAULT_INSTANCE_ID,
  INTEGRATION_MODULE,
  resolveIntegrationOptions,
} from "@gorgo/medusa-integration";

export type ResolvedOptions =
  | { status: "resolved"; options: Record<string, unknown> }
  | { status: "unavailable"; reason: "missing" | "unsaved" | "disabled" };

export type OptionsContainer = { resolve: (key: string) => unknown };

/** Re-export so callers can pass the same module key the package registers. */
export const INTEGRATION_MODULE_KEY = INTEGRATION_MODULE;

const UNKNOWN_IDENTIFIER_PATTERN = /No integration provider registered/i;
const NOT_AVAILABLE_PATTERN =
  /is not available|not configured, disabled, or missing required options/i;
// Awilix when the Integration Module is not on the caller's cradle (payment
// and notification providers). Those callers use the package helper instead.
const MODULE_UNREACHABLE_PATTERN = /Could not resolve/i;

type IntegrationModuleLike = {
  getResolvedOptions: (
    identifier: string,
    instanceId?: string | null
  ) => Promise<unknown>;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function isModuleUnreachableError(error: unknown): boolean {
  return MODULE_UNREACHABLE_PATTERN.test(errorMessage(error));
}

/**
 * Package helper used when the caller's container cannot see the Integration
 * Module (isolated payment and notification provider cradles). Maps the same
 * unavailable states the container path maps.
 */
async function fetchViaPackageHelper(
  identifier: string,
  instanceId: string | null
): Promise<ResolvedOptions> {
  try {
    const options = await resolveIntegrationOptions(
      { identifier, instance_id: instanceId },
      { optional: true }
    );
    if (options === null || options === undefined) {
      return { status: "unavailable", reason: "unsaved" };
    }
    return interpretResolved({ options });
  } catch (error) {
    if (isUnknownIdentifierError(error)) {
      return { status: "unavailable", reason: "missing" };
    }
    if (isNotAvailableError(error)) {
      return { status: "unavailable", reason: "unsaved" };
    }
    throw error;
  }
}

/**
 * Turns whatever the module returned into one of two shapes. Observed form is
 * `{ options, meta }` for a saved and enabled card, and `null` for unsaved or
 * disabled. Empty objects are treated as unsaved.
 */
export function interpretResolved(result: unknown): ResolvedOptions {
  if (result === null || result === undefined || typeof result !== "object") {
    return { status: "unavailable", reason: "unsaved" };
  }
  const record = result as Record<string, unknown>;
  const meta = record.meta as Record<string, unknown> | undefined;
  if (record.enabled === false || meta?.is_enabled === false) {
    return { status: "unavailable", reason: "disabled" };
  }
  const nested = record.options;
  if (nested && typeof nested === "object") {
    return { status: "resolved", options: nested as Record<string, unknown> };
  }
  if (Object.keys(record).length === 0) {
    return { status: "unavailable", reason: "unsaved" };
  }
  // Defensive: a flat options object without the observed wrapper.
  const values = { ...record };
  delete values.enabled;
  delete values.meta;
  if (Object.keys(values).length === 0) {
    return { status: "unavailable", reason: "unsaved" };
  }
  return { status: "resolved", options: values };
}

export function isUnknownIdentifierError(error: unknown): boolean {
  return UNKNOWN_IDENTIFIER_PATTERN.test(errorMessage(error));
}

export function isNotAvailableError(error: unknown): boolean {
  return NOT_AVAILABLE_PATTERN.test(errorMessage(error));
}

/**
 * Reads the card at the moment of the call. The module caches resolved options
 * for a short time per process and clears that cache when a card is saved in
 * the same process (callers that must see their own write should call
 * clearOptionsCache). This function adds no cache of its own.
 */
export async function fetchResolvedOptions(
  container: OptionsContainer,
  identifier: string,
  instanceId: string | null = DEFAULT_INSTANCE_ID
): Promise<ResolvedOptions> {
  let service: IntegrationModuleLike;
  try {
    service = container.resolve(INTEGRATION_MODULE_KEY) as IntegrationModuleLike;
  } catch (error) {
    if (isModuleUnreachableError(error)) {
      return fetchViaPackageHelper(identifier, instanceId);
    }
    throw error;
  }

  try {
    return interpretResolved(
      await service.getResolvedOptions(identifier, instanceId)
    );
  } catch (error) {
    if (isUnknownIdentifierError(error)) {
      return { status: "unavailable", reason: "missing" };
    }
    if (isNotAvailableError(error)) {
      return { status: "unavailable", reason: "unsaved" };
    }
    throw error;
  }
}
