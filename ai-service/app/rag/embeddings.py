"""
Step 2 of RAG: turn text into a list of numbers (a vector) such that texts with similar MEANING get similar vectors.
Three interchangeable providers; the rest of the app only sees `Embedder`.
"""
import hashlib
import math
import re
from typing import Protocol

import httpx

from app.core.config import EMBEDDING_DIMENSIONS, Settings
from app.core.errors import AppError

BATCH_SIZE = 64


class Embedder(Protocol):
    name: str
    is_demo: bool

    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...
    async def embed_query(self, text: str) -> list[float]: ...


STOPWORDS = frozenset(
    "a an and are as at be but by can do does for from has have how i if in into is it its of on or so than that the their "
    "then there these they this to was we were what when where which who why will with would you your about not no yes "
    "also each just more most only other some such very".split()
)


def tokens(text: str) -> list[str]:
    """Lower-cased words without filler words, with a crude stemmer so 'joins' matches 'join'."""
    out = []
    for w in re.findall(r"[a-z0-9]+", text.lower()):
        if w in STOPWORDS or len(w) < 2:
            continue
        for suffix in ("ing", "es", "ed", "s"):
            if w.endswith(suffix) and len(w) - len(suffix) >= 3:
                w = w[: -len(suffix)]
                break
        out.append(w)
    return out


class FakeEmbedder:
    """
    DEMO MODE. Not "meaning": it hashes each word into one of 1024 slots (the "hashing trick"), so two texts are
    similar when they share words. Good enough to run and test the whole pipeline with no keys and no network.
    """

    name = "fake"
    is_demo = True

    def _vector(self, text: str) -> list[float]:
        vec = [0.0] * EMBEDDING_DIMENSIONS
        for tok in tokens(text):
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            vec[h % EMBEDDING_DIMENSIONS] += 1.0 if (h >> 40) & 1 else -1.0
        norm = math.sqrt(sum(x * x for x in vec))
        if norm == 0:
            vec[0] = 1.0
            return vec
        return [x / norm for x in vec]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(t) for t in texts]

    async def embed_query(self, text: str) -> list[float]:
        return self._vector(text)


class _HttpEmbedder:
    """Shared plumbing for providers that are one HTTP POST: Voyage and OpenAI-style APIs."""

    is_demo = False
    name = "http"

    def __init__(self, settings: Settings, url: str, model: str):
        self._key, self._url, self._model = settings.embedding_api_key, url, model

    def _payload(self, texts: list[str], kind: str) -> dict:
        raise NotImplementedError

    async def _embed(self, texts: list[str], kind: str) -> list[list[float]]:
        out: list[list[float]] = []
        async with httpx.AsyncClient(timeout=60) as client:
            for i in range(0, len(texts), BATCH_SIZE):
                batch = texts[i : i + BATCH_SIZE]
                try:
                    res = await client.post(self._url, headers={"Authorization": f"Bearer {self._key}"}, json=self._payload(batch, kind))
                except httpx.HTTPError as err:
                    raise AppError(502, "EMBEDDING_UNAVAILABLE", f"Could not reach the {self.name} embeddings service ({type(err).__name__}).") from err
                if res.status_code in (401, 403):
                    raise AppError(502, "EMBEDDING_AUTH", f"The {self.name} embeddings service rejected the API key. Check EMBEDDING_API_KEY.")
                if res.status_code == 429:
                    raise AppError(503, "EMBEDDING_BUSY", f"The {self.name} embeddings service is rate-limiting us. Try again in a minute.")
                if res.status_code >= 400:
                    raise AppError(502, "EMBEDDING_ERROR", f"The {self.name} embeddings service returned an error ({res.status_code}).")
                data = sorted(res.json()["data"], key=lambda d: d.get("index", 0))
                vectors = [d["embedding"] for d in data]
                if len(vectors) != len(batch):
                    raise AppError(502, "EMBEDDING_ERROR", f"The {self.name} embeddings service returned {len(vectors)} vectors for {len(batch)} texts.")
                if any(len(v) != EMBEDDING_DIMENSIONS for v in vectors):
                    got = next(len(v) for v in vectors if len(v) != EMBEDDING_DIMENSIONS)
                    raise AppError(
                        502, "EMBEDDING_DIMENSION_MISMATCH",
                        f"The embedding model returned vectors of size {got}, but the database expects {EMBEDDING_DIMENSIONS}. Pick a model/setting that outputs {EMBEDDING_DIMENSIONS}.",
                    )
                out.extend(vectors)
        return out

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return await self._embed(texts, "document") if texts else []

    async def embed_query(self, text: str) -> list[float]:
        return (await self._embed([text], "query"))[0]


class VoyageEmbedder(_HttpEmbedder):
    name = "voyage"

    def __init__(self, settings: Settings):
        base = (settings.embedding_base_url or "https://api.voyageai.com/v1").rstrip("/")
        super().__init__(settings, f"{base}/embeddings", settings.embedding_model or "voyage-4")

    def _payload(self, texts: list[str], kind: str) -> dict:
        # input_type tells Voyage whether this text is a question or a passage; retrieval works better when it knows.
        return {"input": texts, "model": self._model, "input_type": kind, "output_dimension": EMBEDDING_DIMENSIONS}


class OpenAIEmbedder(_HttpEmbedder):
    name = "openai"

    def __init__(self, settings: Settings):
        base = (settings.embedding_base_url or "https://api.openai.com/v1").rstrip("/")
        super().__init__(settings, f"{base}/embeddings", settings.embedding_model or "text-embedding-3-small")
        self._send_dimensions = settings.embedding_base_url is None  # the real OpenAI accepts `dimensions`; other servers may not

    def _payload(self, texts: list[str], kind: str) -> dict:
        body: dict = {"input": texts, "model": self._model}
        if self._send_dimensions:
            body["dimensions"] = EMBEDDING_DIMENSIONS
        return body


def build_embedder(settings: Settings) -> Embedder:
    if settings.embedding_provider == "voyage":
        return VoyageEmbedder(settings)
    if settings.embedding_provider == "openai":
        return OpenAIEmbedder(settings)
    return FakeEmbedder()


def to_pgvector(vec: list[float]) -> str:
    """pgvector reads vectors written like '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"
