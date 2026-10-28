import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { forbidden, unauthorized } from "../utils/errors";

export type Role = "student" | "instructor" | "admin";
export interface AuthUser {
  id: string;
  roles: Role[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ roles: user.roles }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    algorithm: "HS256",
  });
}

function readUser(header: string | undefined): AuthUser | null {
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, { algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub || !Array.isArray(payload.roles)) return null;
    return { id: payload.sub, roles: payload.roles as Role[] };
  } catch {
    return null;
  }
}

/** Requires a valid access token. Sets req.user. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const user = readUser(req.headers.authorization);
  if (!user) throw unauthorized();
  req.user = user;
  next();
};

/** Sets req.user if a valid token is present, otherwise carries on as anonymous. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const user = readUser(req.headers.authorization);
  if (user) req.user = user;
  next();
};

/** Use after `authenticate`. Allows the request only if the user has one of the roles. */
export const requireRole =
  (...allowed: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!req.user.roles.some((r) => allowed.includes(r))) throw forbidden();
    next();
  };
