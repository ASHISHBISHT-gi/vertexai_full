# Setup guide: Vertexon LMS-AI

Follow the steps in order. Commands are for macOS/Linux. On Windows, use WSL2 (Ubuntu) and run everything inside it.
Time needed: about 15 minutes.

## 0. What you need installed

| Tool | Version | Check with | Get it |
|---|---|---|---|
| Docker (Desktop or Engine + Compose) | any recent | `docker compose version` | https://docs.docker.com/get-docker/ |
| Node.js | 22 or newer | `node -v` | https://nodejs.org (or `nvm install 22`) |
| pnpm | 10 or newer | `pnpm -v` | `corepack enable` (comes with Node) or `npm i -g pnpm` |
| Python | 3.11 or newer | `python3 --version` | https://www.python.org |

Ports used: 5432 (database), 4000 (API), 8000 (AI service), 5173 (website). Make sure they are free.

## 1. Unzip and enter the folder

```bash
unzip vertexai-week4.zip
cd vertexai
```

## 2. Start the database

```bash
docker compose up -d
docker compose ps        # "lms_postgres" should say "healthy" after a few seconds
```

## 3. Backend API (open terminal 1)

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and replace `JWT_ACCESS_SECRET` with a fresh random value. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Keep the other values as they are. Then:

```bash
pnpm install
pnpm migrate             # creates the database tables
pnpm seed                # adds demo users, courses, a quiz, a forum thread
pnpm dev                 # leave this running. Expect: "API running on http://localhost:4000"
```

Check it: open http://localhost:4000/health. You should see `{"status":"ok", ...}`.

## 4. AI service (open terminal 2)

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Open `ai-service/.env` and set:

- `DATABASE_URL=postgresql://lms_user:lms_password@localhost:5432/lms_db`
- `JWT_ACCESS_SECRET=` the **exact same value** you put in `backend/.env`

Leave `LLM_PROVIDER=fake` and `EMBEDDING_PROVIDER=fake` (demo mode: no API keys, no cost). Then:

```bash
python -m app.cli index-all                  # makes lecture transcripts searchable
uvicorn app.main:app --reload --port 8000    # leave this running
```

Expect: `AI service ready. LLM=fake, embeddings=fake ** DEMO MODE **`.

## 5. Website (open terminal 3)

```bash
cd frontend
pnpm install
pnpm dev                 # leave this running
```

Open **http://localhost:5173**

## 6. Log in

All demo accounts use the password `Password123!`

| Role | Email |
|---|---|
| Student | `student@lms.dev` |
| Instructor | `instructor@lms.dev` |
| Admin | `admin@lms.dev` |

Things to try: enroll in "SQL for Beginners" as the student, open the **Community** tab, ask the AI tutor a question, switch dark mode (top right) and Hindi (language menu), then log in as the instructor to post an announcement, and as the admin to open **Admin > Moderation**.

Emails are not really sent unless you set `SMTP_HOST` in `backend/.env`. Without it they are printed in terminal 1.

---

## Option B: run everything in Docker instead (no Node or Python needed)

```bash
cp .env.example .env
```

Edit the root `.env`: set `JWT_ACCESS_SECRET` (generate as above; if you don't have Node, use `openssl rand -hex 48`) and `POSTGRES_PASSWORD`. Then:

```bash
docker compose --profile app up -d --build
docker compose --profile app run --rm backend pnpm seed
```

Open **http://localhost:8080** and log in with the demo accounts above.
Stop everything: `docker compose --profile app down` (add `-v` to also erase the database).

---

## Optional: run the checks

```bash
cd backend
pnpm typecheck
pnpm test:unit
# Full API test: stop `pnpm dev`, then start the API with rate limits off
RATE_LIMIT_ENABLED=false pnpm dev
# in another terminal:
cd backend && pnpm smoke

cd ../ai-service && source .venv/bin/activate && pytest
```

## Optional: real AI and real email

In `ai-service/.env`: `LLM_PROVIDER=anthropic` plus `ANTHROPIC_API_KEY=...`, and for embeddings `EMBEDDING_PROVIDER=voyage` (or `openai`) plus `EMBEDDING_API_KEY=...`. Restart the service and run `python -m app.cli index-all --force`.
In `backend/.env`: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `port is already allocated` / `EADDRINUSE` | Another program uses that port. Stop it, or change `PORT` in the `.env` file. |
| `pnpm: command not found` | Run `corepack enable`, then reopen the terminal. |
| `Invalid environment configuration` when starting the backend | `backend/.env` is missing or `JWT_ACCESS_SECRET` is shorter than 16 characters. |
| Backend cannot connect to the database | Run `docker compose ps` and wait for "healthy". Check `DATABASE_URL` matches the compose credentials. |
| AI tutor says the service isn't reachable | Terminal 2 isn't running, or its `JWT_ACCESS_SECRET` differs from the backend's. |
| Tutor answers look odd | Normal in demo mode (`fake`): it quotes sentences from the transcript. |
| `429 Too many requests` while testing | The rate limit is working (10 logins per minute per IP). Wait a minute. |
| `pnpm install --frozen-lockfile` fails in Docker | Run `pnpm install` once in `backend/` and `frontend/` to refresh the lockfiles. |
| Want a clean database | `docker compose down -v`, then repeat from step 2. |
