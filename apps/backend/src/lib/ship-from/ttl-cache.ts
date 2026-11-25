type Entry<V> = { value: V; expiresAt: number };

export type TtlCacheOptions = {
  ttlMs: number;
  maxEntries: number;
  /** Replaceable clock for tests. */
  now?: () => number;
};

/**
 * A small in-process cache. Entries expire after the time to live, and when the
 * bound is reached the oldest entry is dropped first (a Map keeps insertion order).
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly now: () => number;

  constructor(private readonly options: TtlCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
