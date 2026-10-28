import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core import db
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.deps import get_embedder
from app.llm import get_llm
from app.routers import chat, generate, status

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ai-service")


@asynccontextmanager
async def lifespan(_: FastAPI):
    s = get_settings()  # fails fast, with a clear message, if the .env is wrong
    await db.open_pool()
    log.info("AI service ready. LLM=%s, embeddings=%s%s", get_llm().name, get_embedder().name, "  ** DEMO MODE: answers are not from a real AI **" if s.demo_mode else "")
    yield
    await db.close_pool()


app = FastAPI(title="Vertexon AI service", lifespan=lifespan)
install_error_handlers(app)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in get_settings().cors_origin.split(",")], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    await db.fetch_one("SELECT 1 AS ok")
    return {"status": "ok"}


app.include_router(status.router, prefix="/api/v1/ai")
app.include_router(chat.router, prefix="/api/v1/ai")
app.include_router(generate.router, prefix="/api/v1/ai")
