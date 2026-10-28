from functools import lru_cache

from app.core.config import get_settings
from app.llm.base import LEVELS, TutorLLM
from app.llm.claude import ClaudeLLM
from app.llm.fake import FakeLLM

__all__ = ["LEVELS", "TutorLLM", "get_llm"]


@lru_cache
def get_llm() -> TutorLLM:
    s = get_settings()
    return ClaudeLLM(s) if s.llm_provider == "anthropic" else FakeLLM()
