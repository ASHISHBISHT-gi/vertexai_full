/**
 * A small in-memory cache where every entry expires after a fixed time.
 *
 * Used for read-heavy endpoints (catalog, leaderboard) so repeated requests don't hit Postgres.
 * It lives inside this one Node process: fast and zero setup, but each server copy has its own cache and it empties on
 * restart. That's fine for one server. When you run several copies, swap the body of this class for Redis (same 4 methods).
 */
export class TtlCache {
  private entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private maxEntries = 500, private now: () => number = Date.now) {}

  get<T>(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    if (this.entries.size >= this.maxEntries) {
      // Make room: drop expired entries first, then the oldest one (a Map remembers insertion order).
      for (const [k, v] of this.entries) if (v.expiresAt <= this.now()) this.entries.delete(k);
      if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  /** Returns the cached value, or runs `load`, stores the result and returns it. */
  async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await load();
    this.set(key, value, ttlSeconds);
    return value;
  }

  /** Forget every key that starts with `prefix` (e.g. "catalog:" after a course changes). */
  invalidatePrefix(prefix: string): void {
    for (const k of this.entries.keys()) if (k.startsWith(prefix)) this.entries.delete(k);
  }

  clear(): void {
    this.entries.clear();
  }
}

/** The app-wide cache. Keys are namespaced: "catalog:...", "leaderboard:...". */
export const cache = new TtlCache();
