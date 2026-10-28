from functools import lru_cache

from app.core.config import get_settings
from app.rag.embeddings import Embedder, build_embedder


@lru_cache
def get_embedder() -> Embedder:
    return build_embedder(get_settings())
