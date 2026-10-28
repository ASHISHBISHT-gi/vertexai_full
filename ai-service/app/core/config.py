from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Must match `vector(1024)` in the database migration. Changing embedding model = same size, or re-create the table.
EMBEDDING_DIMENSIONS = 1024


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    jwt_access_secret: str = Field(min_length=16)
    cors_origin: str = "http://localhost:5173"

    llm_provider: Literal["fake", "anthropic"] = "fake"
    anthropic_api_key: str | None = None
    anthropic_base_url: str | None = None  # only for tests (point the SDK at a fake server)
    llm_chat_model: str = "claude-haiku-5-5"
    llm_generate_model: str = "claude-sonnet-5-5"
    # Haiku 5.5 / newer models may "think" first, and thinking tokens count against max_tokens, so leave generous room.
    llm_chat_max_tokens: int = 3000
    llm_generate_max_tokens: int = 8000

    embedding_provider: Literal["fake", "voyage", "openai"] = "fake"
    embedding_api_key: str | None = None
    embedding_model: str | None = None
    embedding_base_url: str | None = None

    retrieval_top_k: int = 5
    min_similarity: float = 0.10  # passages less similar than this are ignored
    chat_rate_limit_per_minute: int = 20
    chat_history_messages: int = 6

    @model_validator(mode="after")
    def _check_keys(self):
        if self.llm_provider == "anthropic" and not self.anthropic_api_key:
            raise ValueError("LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY (or use LLM_PROVIDER=fake)")
        if self.embedding_provider in ("voyage", "openai") and not self.embedding_api_key:
            raise ValueError(f"EMBEDDING_PROVIDER={self.embedding_provider} needs EMBEDDING_API_KEY (or use EMBEDDING_PROVIDER=fake)")
        return self

    @property
    def demo_mode(self) -> bool:
        return self.llm_provider == "fake" or self.embedding_provider == "fake"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  (values come from the environment / .env)
