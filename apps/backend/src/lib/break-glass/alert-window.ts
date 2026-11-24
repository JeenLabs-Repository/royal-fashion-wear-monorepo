// "Open once per 15 minutes": decides whether a use of the break-glass account
// starts a new alert window.
//
// The primary store is an atomic acquire of the Medusa Locking module with a 900
// second expiry that is never released, so the window ends by itself. Every
// attempt uses a fresh owner id: the same owner could re-acquire its own key, a
// different one cannot, so only the first caller inside the window succeeds.
// This works with Redis on or off and adds no package. An in-memory Locking
// provider is atomic only inside one backend process (the planned single
// instance); a second instance needs the Redis locking provider that ships
// inside @medusajs/medusa.
//
// Fallbacks, each logged: the cache module (a get then a set, which is not
// atomic), then a process-local memory store.

import type { MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { randomUUID } from "node:crypto";

export const WINDOW_SECONDS = 900;
const WINDOW_MS = WINDOW_SECONDS * 1000;

// Spike S7: Locking `expire` is in seconds.
const LOCK_EXPIRE_PER_SECOND = 1;

// Spike S7: a held key throws "Failed to acquire lock for key \"...\"".
export const LOCK_HELD_PATTERN = /failed to acquire|already (?:locked|acquired|held)|is locked|lock.*held/i;

export const windowKey = (actorId: string): string => `break-glass:window:${actorId}`;

export interface AlertWindowStore {
  /** True only for the caller that opened the window. */
  tryOpen(key: string, ttlSeconds: number, nowMs?: number): Promise<boolean>;
}

type LockingApi = {
  acquire(keys: string[], args: { expire: number; ownerId: string }): Promise<unknown>;
  release(keys: string[], args?: { ownerId?: string }): Promise<unknown>;
};

type CacheApi = {
  get(key: string): Promise<unknown>;
  set(key: string, data: unknown, ttl?: number): Promise<unknown>;
  invalidate?(key: string): Promise<unknown>;
};

// Owner id of the last successful acquire per key, kept only so a test can free the key.
const lastOwners = new Map<string, string>();

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class LockAlertWindowStore implements AlertWindowStore {
  private readonly locking: LockingApi;

  constructor(locking: LockingApi) {
    this.locking = locking;
  }

  async tryOpen(key: string, ttlSeconds: number): Promise<boolean> {
    const ownerId = `window-${randomUUID()}`;
    try {
      await this.locking.acquire([key], { expire: ttlSeconds * LOCK_EXPIRE_PER_SECOND, ownerId });
      lastOwners.set(key, ownerId);
      return true;
    } catch (error) {
      if (LOCK_HELD_PATTERN.test(messageOf(error))) {
        return false;
      }
      // Anything else (a broken connection) is the caller's to log.
      throw error;
    }
  }
}

export class CacheAlertWindowStore implements AlertWindowStore {
  private readonly cache: CacheApi;

  constructor(cache: CacheApi) {
    this.cache = cache;
  }

  async tryOpen(key: string, ttlSeconds: number): Promise<boolean> {
    // Not atomic: two simultaneous first requests could both pass. The unique
    // open-review index and the notification idempotency key cover that race.
    if (await this.cache.get(key)) {
      return false;
    }
    await this.cache.set(key, { opened_at: new Date().toISOString() }, ttlSeconds);
    return true;
  }
}

export class MemoryAlertWindowStore implements AlertWindowStore {
  private readonly openUntil = new Map<string, number>();

  async tryOpen(key: string, ttlSeconds: number, nowMs: number = Date.now()): Promise<boolean> {
    const until = this.openUntil.get(key);
    if (until !== undefined && nowMs < until) {
      return false;
    }
    this.openUntil.set(key, nowMs + ttlSeconds * 1000);
    return true;
  }

  clear(key?: string): void {
    if (key === undefined) {
      this.openUntil.clear();
    } else {
      this.openUntil.delete(key);
    }
  }
}

const MEMORY_STORE = new MemoryAlertWindowStore();

function warn(container: MedusaContainer, message: string): void {
  try {
    container.resolve<{ warn(message: string): void }>("logger").warn(message);
  } catch {
    console.warn(message);
  }
}

function pickStore(container: MedusaContainer): AlertWindowStore {
  try {
    return new LockAlertWindowStore(container.resolve<LockingApi>(Modules.LOCKING));
  } catch {
    // Fall through to the next store.
  }
  try {
    const cache = container.resolve<CacheApi>(Modules.CACHE);
    warn(container, "[break-glass] locking module unavailable, using the cache for the alert window (not atomic)");
    return new CacheAlertWindowStore(cache);
  } catch {
    warn(container, "[break-glass] locking and cache modules unavailable, using process memory for the alert window");
    return MEMORY_STORE;
  }
}

/**
 * Tries to open the alert window for an actor.
 * @param now milliseconds since the epoch, injectable for tests
 * @returns whether this call opened it and the 15-minute bucket of `now` (used in
 * the idempotency key and the review row, so two windows never share one)
 */
export async function tryOpenAlertWindow(
  container: MedusaContainer,
  actorId: string,
  now: number = Date.now()
): Promise<{ opened: boolean; bucket: number }> {
  const opened = await pickStore(container).tryOpen(windowKey(actorId), WINDOW_SECONDS, now);
  return { opened, bucket: Math.floor(now / WINDOW_MS) };
}

/**
 * Frees a window so a test can trigger the alert again. Throws outside a test run.
 */
export async function resetAlertWindowForTests(
  container: MedusaContainer,
  actorId: string
): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    // eslint-disable-next-line @medusajs/use-medusa-error-not-generic-error
    throw new Error("resetAlertWindowForTests only runs when NODE_ENV is test");
  }
  const key = windowKey(actorId);
  MEMORY_STORE.clear(key);

  const ownerId = lastOwners.get(key);
  if (ownerId) {
    try {
      // Spike S7: release with the owner id that opened the window.
      await container.resolve<LockingApi>(Modules.LOCKING).release([key], { ownerId });
    } catch {
      // The key may already have expired.
    }
    lastOwners.delete(key);
  }
  try {
    await container.resolve<CacheApi>(Modules.CACHE).invalidate?.(key);
  } catch {
    // No cache module in this run.
  }
}
