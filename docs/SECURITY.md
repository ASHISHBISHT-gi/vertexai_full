# Security review (Week 4, day 27)

Checked against the PRD's non-functional requirements. "Done" = implemented and covered by the smoke test or a unit test.

| Area | Status | Where |
|---|---|---|
| Passwords hashed (bcrypt, 10 rounds), login timing equalised for unknown emails | Done | `auth.service.ts` |
| Short-lived access JWT (15 min) + rotating single-use refresh tokens stored as hashes | Done | `auth.service.ts`, smoke test |
| RBAC at the route (`requireRole`) and ownership at the service layer | Done | `middleware/auth.ts`, `shared/access.ts` |
| Forum/announcements/leaderboard limited to enrolled students, the owner and admins; unapproved courses are 404 | Done | `requireCourseMember`, Week 4b smoke tests |
| Input validation on every endpoint (zod), uniform error format | Done | `*.routes.ts`, `middleware/error.ts` |
| Rate limits: auth 10/min/IP, other 100/min/user, posting 10/min/user, AI chat 20/min/user | Done | `middleware/rateLimit.ts`, `ai-service/app/core/ratelimit.py`, `RATE_LIMIT_CHECK=1 pnpm smoke` |
| Security headers (nosniff, frame deny, referrer policy), no `X-Powered-By` | Done | `middleware/security.ts`, nginx.conf |
| User text is rendered by React (escaped), never as HTML | Done | `ThreadView.tsx` |
| Uploaded files: type sniffing, size limits, no SVG, path-traversal guard | Done (Week 2/4a) | `storage.ts`, `upload.ts` |
| Request ids + structured JSON logs; health checks | Done | `requestLogger`, `/health`, `/healthz` |
| Containers run as non-root; secrets come from env, not images | Done | Dockerfiles |
| Audit trail for moderation and admin actions | Done | `audit_logs` |

## Findings you need to act on

1. **`backend/.env` was committed to git**, including `JWT_ACCESS_SECRET`. `.gitignore` now ignores it, but the old value is in your history. Run `git rm --cached backend/.env`, generate a new secret, and put it in `backend/.env`, `ai-service/.env` and your server's `.env`. If the repo is public, treat the old secret as leaked (anyone with it can forge admin tokens).
2. **Suspended users keep working for up to 15 minutes.** Access tokens are checked without a database lookup. Their refresh token is revoked, so it ends at the next refresh. Acceptable for this scope; if you need instant cut-off, look up `is_active` in `authenticate` (costs one query per request).
3. **Rate limiting and caching are in-process memory.** Correct for one server. With several copies each has its own counters and cache; swap `lib/rateLimiter.ts` and `lib/ttlCache.ts` for Redis then.
4. **Uploads live on local disk** (a Docker volume in compose). Back it up, or move `storage.ts` to S3/MinIO before real use.
5. Put the site behind HTTPS (Caddy, a cloud load balancer, or certbot in front of the nginx container) and set `APP_URL` to the https address.
6. Run `pnpm audit` and `pip-audit` before release.
