import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

/** A small set of protective response headers (the useful subset of what the `helmet` package sets). */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.removeHeader("X-Powered-By");
  next();
};

/** Gives every request an id (returned as X-Request-Id) and logs one JSON line per request when it finishes. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const id = (typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].slice(0, 64)) || randomUUID();
  const started = process.hrtime.bigint();
  res.setHeader("X-Request-Id", id);
  res.on("finish", () => {
    if (req.path === "/health") return; // health checks would drown the log
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(JSON.stringify({ level: res.statusCode >= 500 ? "error" : "info", msg: "request", id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms * 10) / 10, user: req.user?.id }));
  });
  next();
};
