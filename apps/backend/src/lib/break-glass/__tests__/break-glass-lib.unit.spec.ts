import { Modules } from "@medusajs/framework/utils";
import {
  LockAlertWindowStore,
  MemoryAlertWindowStore,
  tryOpenAlertWindow,
  WINDOW_SECONDS,
} from "../alert-window";
import { getBreakGlassAlertRecipients, parseAlertEmails } from "../parse-alert-emails";
import { findStaleOpenReviews } from "../stale-reviews";
import { formatIst, istDate } from "../time";

describe("parseAlertEmails", () => {
  test("trims, lower-cases, de-duplicates and keeps order", () => {
    expect(parseAlertEmails(" Owner@Example.test, second@example.test ,OWNER@example.test").valid).toEqual([
      "owner@example.test",
      "second@example.test",
    ]);
  });

  test("separates invalid entries and drops empty ones", () => {
    const result = parseAlertEmails("ok@example.test,,not-an-address, a b@example.test ,@example.test,x@y");
    expect(result.valid).toEqual(["ok@example.test"]);
    expect(result.invalid).toEqual(["not-an-address", "a b@example.test", "@example.test", "x@y"]);
  });

  test("unset, empty and blank values give nothing", () => {
    for (const raw of [undefined, null, "", "  ", " , , "]) {
      expect(parseAlertEmails(raw)).toEqual({ valid: [], invalid: [] });
    }
  });

  test("reads the environment variable", () => {
    expect(getBreakGlassAlertRecipients({ BREAK_GLASS_ALERT_EMAILS: "a@example.test,b@example.test" })).toEqual([
      "a@example.test",
      "b@example.test",
    ]);
    expect(getBreakGlassAlertRecipients({})).toEqual([]);
  });
});

describe("MemoryAlertWindowStore", () => {
  test("opens once per window and again after it expires", async () => {
    const store = new MemoryAlertWindowStore();
    const t0 = 1_700_000_000_000;
    expect(await store.tryOpen("k", WINDOW_SECONDS, t0)).toBe(true);
    expect(await store.tryOpen("k", WINDOW_SECONDS, t0 + 1_000)).toBe(false);
    expect(await store.tryOpen("k", WINDOW_SECONDS, t0 + WINDOW_SECONDS * 1000 - 1)).toBe(false);
    expect(await store.tryOpen("k", WINDOW_SECONDS, t0 + WINDOW_SECONDS * 1000)).toBe(true);
  });

  test("keys are independent", async () => {
    const store = new MemoryAlertWindowStore();
    expect(await store.tryOpen("a", 60, 0)).toBe(true);
    expect(await store.tryOpen("b", 60, 0)).toBe(true);
  });
});

function fakeLocking(clock: { now: number }) {
  const held = new Map<string, { owner: string; until: number }>();
  return {
    held,
    acquire: jest.fn(async (keys: string[], args: { expire: number; ownerId: string }) => {
      for (const key of keys) {
        const current = held.get(key);
        if (current && clock.now < current.until && current.owner !== args.ownerId) {
          throw new Error(`Failed to acquire lock for key "${key}"`);
        }
        held.set(key, { owner: args.ownerId, until: clock.now + args.expire * 1000 });
      }
    }),
    release: jest.fn(async () => true),
  };
}

describe("LockAlertWindowStore", () => {
  test("a second owner fails inside the window and succeeds after it", async () => {
    const clock = { now: 0 };
    const store = new LockAlertWindowStore(fakeLocking(clock));
    expect(await store.tryOpen("break-glass:window:u1", WINDOW_SECONDS)).toBe(true);
    clock.now = 10_000;
    expect(await store.tryOpen("break-glass:window:u1", WINDOW_SECONDS)).toBe(false);
    clock.now = WINDOW_SECONDS * 1000 + 1;
    expect(await store.tryOpen("break-glass:window:u1", WINDOW_SECONDS)).toBe(true);
  });

  test("two simultaneous attempts give exactly one success", async () => {
    const store = new LockAlertWindowStore(fakeLocking({ now: 0 }));
    const results = await Promise.all([
      store.tryOpen("break-glass:window:u2", WINDOW_SECONDS),
      store.tryOpen("break-glass:window:u2", WINDOW_SECONDS),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("every attempt uses its own owner id and the lock is never released", async () => {
    const locking = fakeLocking({ now: 0 });
    const store = new LockAlertWindowStore(locking);
    await store.tryOpen("break-glass:window:u3", WINDOW_SECONDS);
    await store.tryOpen("break-glass:window:u3", WINDOW_SECONDS);
    const owners = locking.acquire.mock.calls.map((call) => call[1].ownerId);
    expect(new Set(owners).size).toBe(2);
    expect(locking.release).not.toHaveBeenCalled();
    expect(locking.acquire.mock.calls[0][1].expire).toBe(WINDOW_SECONDS);
  });

  test("an error that is not 'held by another owner' is rethrown", async () => {
    const store = new LockAlertWindowStore({
      acquire: async () => {
        throw new Error("connection refused");
      },
      release: async () => true,
    });
    await expect(store.tryOpen("k", WINDOW_SECONDS)).rejects.toThrow("connection refused");
  });
});

describe("tryOpenAlertWindow", () => {
  test("returns the 15-minute bucket of the time it was given", async () => {
    const locking = fakeLocking({ now: 0 });
    const container = {
      resolve: (key: string) => {
        if (key === Modules.LOCKING) {
          return locking;
        }
        throw new Error("not registered");
      },
    };
    const t = 1_700_000_000_000;
    const first = await tryOpenAlertWindow(container as never, "u4", t);
    expect(first).toEqual({ opened: true, bucket: Math.floor(t / 900_000) });
    const second = await tryOpenAlertWindow(container as never, "u4", t + 5_000);
    expect(second.opened).toBe(false);
    expect(second.bucket).toBe(first.bucket);
  });

  test("buckets of two windows 15 minutes apart differ", async () => {
    const t = 1_700_000_000_000;
    expect(Math.floor((t + 900_000) / 900_000)).toBe(Math.floor(t / 900_000) + 1);
  });

  test("falls back to the in-memory store when no locking or cache module resolves", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const container = {
      resolve: () => {
        throw new Error("not registered");
      },
    };
    const t = 1_700_000_100_000;
    expect((await tryOpenAlertWindow(container as never, "u5", t)).opened).toBe(true);
    expect((await tryOpenAlertWindow(container as never, "u5", t + 1_000)).opened).toBe(false);
    expect((await tryOpenAlertWindow(container as never, "u5", t + WINDOW_SECONDS * 1000)).opened).toBe(true);
    jest.restoreAllMocks();
  });
});

describe("findStaleOpenReviews", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  const service = (rows: Array<{ id: string; opened_at: Date; closed_at: Date | null }>) => ({
    listBreakGlassReviews: jest.fn(async () => rows),
  });

  test("returns only open reviews at least the given hours old, oldest first", async () => {
    const rows = [
      { id: "new", opened_at: hoursAgo(2), closed_at: null },
      { id: "older", opened_at: hoursAgo(30), closed_at: null },
      { id: "closed-old", opened_at: hoursAgo(80), closed_at: hoursAgo(70) },
      { id: "edge", opened_at: hoursAgo(24), closed_at: null },
      { id: "oldest", opened_at: hoursAgo(50), closed_at: null },
    ];
    const stale = await findStaleOpenReviews(service(rows), now, 24);
    expect(stale.map((row) => row.id)).toEqual(["oldest", "older", "edge"]);
  });

  test("accepts dates serialised as strings", async () => {
    const rows = [{ id: "a", opened_at: hoursAgo(30).toISOString() as unknown as Date, closed_at: null }];
    expect((await findStaleOpenReviews(service(rows), now, 24)).map((row) => row.id)).toEqual(["a"]);
  });

  test("returns nothing when no review is old enough", async () => {
    const rows = [{ id: "new", opened_at: hoursAgo(1), closed_at: null }];
    expect(await findStaleOpenReviews(service(rows), now, 24)).toEqual([]);
  });
});

describe("time helpers", () => {
  test("formatIst writes Indian Standard Time and ends with IST", () => {
    const text = formatIst(new Date("2026-01-10T03:30:00Z"));
    expect(text.endsWith(" IST")).toBe(true);
    expect(text).toContain("9:00");
  });

  test("istDate gives the calendar date in India", () => {
    expect(istDate(new Date("2026-01-10T19:00:00Z"))).toBe("2026-01-11");
    expect(istDate(new Date("2026-01-10T03:30:00Z"))).toBe("2026-01-10");
  });
});
