// Run with: pnpm test:unit   (uses Node's built-in test runner, no extra packages)
import assert from "node:assert/strict";
import { test } from "node:test";
import { RateLimiter } from "./rateLimiter";
import { TtlCache } from "./ttlCache";

test("rate limiter blocks the 11th hit in a minute and reports when to retry", () => {
  let t = 1_000_000;
  const rl = new RateLimiter(() => t);
  for (let i = 0; i < 10; i++) assert.equal(rl.hit("ip:1", 10, 60_000).allowed, true);
  const blocked = rl.hit("ip:1", 10, 60_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(rl.hit("ip:2", 10, 60_000).allowed, true, "other keys are independent");
  t += 60_001;
  assert.equal(rl.hit("ip:1", 10, 60_000).allowed, true, "allowed again after the window passes");
});

test("rate limiter is a sliding window, not a fixed bucket", () => {
  let t = 0;
  const rl = new RateLimiter(() => t);
  rl.hit("k", 2, 1000);
  t = 600;
  rl.hit("k", 2, 1000);
  t = 1100; // the first hit has expired, the second hasn't
  assert.equal(rl.hit("k", 2, 1000).allowed, true);
  assert.equal(rl.hit("k", 2, 1000).allowed, false);
});

test("cache entries expire, and remember() only loads once", async () => {
  let t = 0;
  const c = new TtlCache(10, () => t);
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await c.remember("a", 5, load), 1);
  assert.equal(await c.remember("a", 5, load), 1);
  t = 5001;
  assert.equal(await c.remember("a", 5, load), 2);
});

test("invalidatePrefix only forgets matching keys", () => {
  const c = new TtlCache();
  c.set("catalog:1", "x", 60);
  c.set("catalog:2", "y", 60);
  c.set("leaderboard:1", "z", 60);
  c.invalidatePrefix("catalog:");
  assert.equal(c.get("catalog:1"), undefined);
  assert.equal(c.get("catalog:2"), undefined);
  assert.equal(c.get("leaderboard:1"), "z");
});

test("cache evicts the oldest entry when full", () => {
  const c = new TtlCache(2);
  c.set("a", 1, 60);
  c.set("b", 2, 60);
  c.set("c", 3, 60);
  assert.equal(c.get("a"), undefined);
  assert.equal(c.get("c"), 3);
});
