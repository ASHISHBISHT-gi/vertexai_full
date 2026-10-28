# Vertexon AI service

The Python (FastAPI) half of the LMS: the AI tutor. It shares the Postgres database and the login tokens with the Node API.

| Endpoint (all under `/api/v1/ai`) | What it does |
|---|---|
| `GET /status` | which AI is configured; is it demo mode? (public) |
| `POST /lectures/{id}/index` | instructor: read a saved transcript into the knowledge base |
| `POST /chat/sessions`, `POST /chat/sessions/{id}/messages` | the tutor: retrieve passages, answer with citations |
| `PUT /chat/sessions/{id}/mode` | beginner / intermediate / advanced / auto |
| `POST /lectures/{id}/summarize` | lecture summary + key points (cached) |
| `POST /lectures/{id}/generate-quiz` | instructor: a *draft* quiz to review |
| `POST /modules/{id}/flashcards` | revision cards, shared by everyone in the module |
| `POST /study-plan` | personal plan from mastery, progress and deadlines |

## Setup

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate          # fish shell: source .venv/bin/activate.fish
pip install -r requirements.txt
cp .env.example .env               # then edit it (see below)
```

In `.env`, set `DATABASE_URL` and `JWT_ACCESS_SECRET` to the **same values as `backend/.env`**. Leave the providers on `fake` for now.

The Node migration must have run first (`pnpm migrate` in `backend/`): it creates the tables this service uses.

```bash
python -m app.cli index-all        # reads every lecture transcript into the knowledge base
uvicorn app.main:app --reload --port 8000
```

You should see `AI service ready. LLM=fake, embeddings=fake  ** DEMO MODE **`.
Check it: open http://localhost:8000/api/v1/ai/status, or http://localhost:8000/docs for interactive API docs.

## Switching on the real AI (optional, when you have keys)

1. Anthropic key (console.anthropic.com): set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=...`
2. Embeddings key: Anthropic has no embeddings model. Voyage AI (voyageai.com) is the one their docs point to. Set `EMBEDDING_PROVIDER=voyage` and `EMBEDDING_API_KEY=...` (OpenAI works too: `openai`).
3. **Re-index** after changing the embedding provider, because vectors from different models can't be compared: `python -m app.cli index-all --force`
4. Restart. The banner should now say `LLM=anthropic, embeddings=voyage`, with no demo-mode warning.

Nothing needs downloading: no models run on your machine, and each AI call is a small text request.

## Tests

```bash
pytest          # 42 tests, no database, no keys, no internet needed
```
