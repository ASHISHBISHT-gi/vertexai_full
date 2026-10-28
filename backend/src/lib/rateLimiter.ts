/**
 * Sliding-window rate limiter: "at most `limit` hits per `windowMs` for this key".
 * In memory (see ttlCache.ts for what that means when you run several server copies).
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(private now: () => number = Date.now) {}

  /** Records a hit. `allowed` is false when the key is over its limit; `retryAfterSeconds` says when to try again. */
  hit(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = this.now();
    this.sweep(now, windowMs);
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, remaining: limit - recent.length, retryAfterSeconds: 0 };
  }

  /** Once a minute, forget keys that haven't been seen for a whole window, so the map can't grow forever. */
  private sweep(now: number, windowMs: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, times] of this.hits) if (times.length === 0 || now - times[times.length - 1]! >= windowMs) this.hits.delete(k);
  }

  reset() {
    this.hits.clear();
  }
}
