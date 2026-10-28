import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { RateLimiter } from "../lib/rateLimiter";
import { AppError } from "../utils/errors";

const limiter = new RateLimiter();

function limit(name: string, perMinute: number, keyOf: (req: Parameters<RequestHandler>[0]) => string): RequestHandler {
  return (req, res, next) => {
    if (!env.RATE_LIMIT_ENABLED) return next();
    const r = limiter.hit(`${name}:${keyOf(req)}`, perMinute, 60_000);
    res.setHeader("RateLimit-Limit", String(perMinute));
    res.setHeader("RateLimit-Remaining", String(r.remaining));
    if (!r.allowed) {
      res.setHeader("Retry-After", String(r.retryAfterSeconds));
      throw new AppError(429, "RATE_LIMITED", `Too many requests. Try again in ${r.retryAfterSeconds} seconds.`);
    }
    next();
  };
}

/** Who is asking? The user id from a valid token, else the IP address. (Real client IP needs `trust proxy`, set in server.ts.) */
function identity(req: Parameters<RequestHandler>[0]): string {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const p = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, { algorithms: ["HS256"] });
      if (typeof p !== "string" && p.sub) return `user:${p.sub}`;
    } catch {
      /* invalid token: fall through to IP, so forged tokens can't dodge the limit */
    }
  }
  return `ip:${req.ip ?? "unknown"}`;
}

/** PRD 8.9: /auth/* -> 10 requests per minute per IP. Stops password guessing and signup spam. */
export const authLimiter = limit("auth", env.RATE_LIMIT_AUTH_PER_MIN, (req) => req.ip ?? "unknown");
/** PRD 8.9: everything else -> 100 per minute per user (per IP when signed out). */
export const apiLimiter = limit("api", env.RATE_LIMIT_API_PER_MIN, identity);
/** Posting content (forum, announcements): tighter, so one account can't flood a course. */
export const postLimiter = limit("post", env.RATE_LIMIT_POST_PER_MIN, identity);

export const resetRateLimits = () => limiter.reset();
