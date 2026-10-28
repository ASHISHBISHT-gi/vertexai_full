# Vertexon LMS-AI

Learning platform with an AI tutor: React + TypeScript frontend, Node/Express API, Python/FastAPI AI service, PostgreSQL + pgvector.

```
frontend/    React 19, Vite, Tailwind, TanStack Query   (served by nginx in Docker)
backend/     Express 5 API, migrations, seed, smoke test
ai-service/  FastAPI: RAG tutor, summaries, quizzes, flashcards, study plans
docker-compose.yml   Postgres for development; the whole stack with --profile app
.github/workflows/   ci.yml (every PR), deploy.yml (version tags)
infra/k6/    load test        docs/SECURITY.md   security review
```

## Run it for development

```bash
docker compose up -d                       # Postgres + pgvector
cd backend && cp .env.example .env         # edit JWT_ACCESS_SECRET
pnpm install && pnpm migrate && pnpm seed && pnpm dev
cd ../ai-service && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cp .env.example .env && python -m app.cli index-all && uvicorn app.main:app --reload --port 8000
cd ../frontend && pnpm install && pnpm dev # http://localhost:5173
```

Demo logins (password `Password123!`): `admin@lms.dev`, `instructor@lms.dev`, `student@lms.dev`.
Emails are printed in the backend log until you set `SMTP_HOST`.

## Run everything in containers

```bash
cp .env.example .env                       # set JWT_ACCESS_SECRET and POSTGRES_PASSWORD
docker compose --profile app up -d --build # http://localhost:8080
docker compose --profile app run --rm backend pnpm seed   # optional demo data
```

## Tests

| Command | What it checks |
|---|---|
| `cd backend && pnpm typecheck` | TypeScript |
| `pnpm test:unit` | rate limiter and cache logic |
| `pnpm smoke` | the whole API end to end (start the server with `RATE_LIMIT_ENABLED=false`) |
| `RATE_LIMIT_CHECK=1 pnpm smoke` | the rate limiter (server with limits ON) |
| `cd ai-service && pytest` | AI service |
| `k6 run infra/k6/load.js` | 100 users, p95 under 300 ms |

## Week 4 additions (API)

| Endpoint | Who |
|---|---|
| `GET/POST /courses/:id/threads`, `GET /threads/:id`, `POST /threads/:id/posts`, `PUT /threads/:id/pin`, `DELETE /threads/:id` | enrolled students, owner, admin |
| `DELETE /posts/:id`, `POST /posts/:id/report`, `PUT /posts/:id/dismiss-reports` | author / any member / owner+admin |
| `GET /admin/moderation/flagged-posts` | admin |
| `GET/POST /courses/:id/announcements`, `DELETE /announcements/:id` | members read; owner/admin post |
| `GET /leaderboard/:courseId` | members (cached 60 s) |
| `GET/PUT /notifications/preferences` | signed-in user (email on/off) |

## Deploying

1. Server with Docker. Clone the repo, create `.env` (see above) with `APP_URL=https://your-domain`.
2. Put HTTPS in front of port 8080 (Caddy: `your-domain { reverse_proxy localhost:8080 }`).
3. Tag a release: `git tag v1.0.0 && git push origin v1.0.0`. `deploy.yml` pushes images to GHCR and, if you add the secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH`, restarts the stack over SSH.
4. Rollback: on the server `git checkout v<previous> && docker compose --profile app up -d --build`.
