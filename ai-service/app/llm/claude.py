"""The real AI: Claude through Anthropic's API."""
import logging
from typing import TypeVar

from anthropic import APIConnectionError, APIStatusError, AsyncAnthropic
from pydantic import BaseModel, ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.llm import prompts
from app.llm.json_utils import extract_json
from app.llm.schemas import CardOut, CardsOut, Excerpt, PlanOut, QuizOut, SummaryOut, Turn
from app.rag.chunking import parse_transcript

log = logging.getLogger("ai-service")
T = TypeVar("T", bound=BaseModel)
MAX_TRANSCRIPT_CHARS = 60_000


def plain_text(transcript: str) -> str:
    """Timestamps are noise for summaries and quizzes: keep just the words."""
    text = " ".join(seg.text for seg in parse_transcript(transcript))
    return text[:MAX_TRANSCRIPT_CHARS]


def _when(seconds: int | None) -> str:
    return "" if seconds is None else f"at {seconds // 60}:{seconds % 60:02d}"


class ClaudeLLM:
    name = "anthropic"
    is_demo = False

    def __init__(self, settings: Settings):
        self._s = settings
        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key, base_url=settings.anthropic_base_url, timeout=90, max_retries=2)

    def with_http_client(self, http_client) -> "ClaudeLLM":
        """Test hook: swap in a fake HTTP transport (an httpx2.AsyncClient with the SDK 1.x, httpx.AsyncClient before)."""
        self._client = AsyncAnthropic(api_key="test", base_url="https://api.anthropic.test", http_client=http_client, max_retries=0)
        return self

    # ---- one call to the API -----------------------------------------------------------------
    async def _complete(self, *, model: str, system: str, messages: list[dict], max_tokens: int) -> str:
        # Deliberately no temperature/top_p/prefill: newer models (Haiku 5.5) reject those parameters.
        try:
            reply = await self._client.messages.create(model=model, max_tokens=max_tokens, system=system, messages=messages)
        except APIStatusError as err:
            log.warning("Anthropic API error %s: %s", err.status_code, getattr(err, "message", err))
            if err.status_code in (401, 403):
                raise AppError(502, "AI_AUTH", "The AI provider rejected our API key. The site owner needs to check ANTHROPIC_API_KEY.") from err
            if err.status_code == 404:
                raise AppError(502, "AI_MODEL", f"The AI model '{model}' wasn't found. Check LLM_CHAT_MODEL / LLM_GENERATE_MODEL.") from err
            if err.status_code in (429, 529):
                raise AppError(503, "AI_BUSY", "The AI is busy right now. Please try again in a moment.") from err
            raise AppError(502, "AI_ERROR", "The AI provider returned an error. Please try again.") from err
        except APIConnectionError as err:
            raise AppError(502, "AI_UNAVAILABLE", "Couldn't reach the AI provider. Check the internet connection and try again.") from err

        # The reply is a list of blocks. Newer models may put "thinking" blocks first, so keep only the text ones.
        text = "".join(block.text for block in reply.content if getattr(block, "type", None) == "text").strip()
        if not text:
            why = "ran out of room while thinking" if reply.stop_reason == "max_tokens" else "returned no text"
            raise AppError(502, "AI_EMPTY", f"The AI {why}. Please try again.")
        return text

    # ---- JSON tasks: ask, validate, and if it's wrong, tell the model what was wrong (once) ---------
    async def _json(self, *, system: str, user: str, schema: type[T]) -> T:
        messages: list[dict] = [{"role": "user", "content": user}]
        last_error = ""
        for attempt in range(2):
            text = await self._complete(model=self._s.llm_generate_model, system=system, messages=messages, max_tokens=self._s.llm_generate_max_tokens)
            try:
                return schema.model_validate(extract_json(text))
            except (ValueError, ValidationError) as err:
                last_error = str(err)[:600]
                log.warning("AI returned invalid JSON (attempt %s): %s", attempt + 1, last_error)
                messages += [
                    {"role": "assistant", "content": text},
                    {"role": "user", "content": f"That reply was not valid: {last_error}\nReply again with ONLY the corrected JSON object."},
                ]
        raise AppError(502, "AI_BAD_OUTPUT", "The AI gave an answer we couldn't use. Please try again.")

    # ---- the tasks ------------------------------------------------------------------------------
    async def answer(self, *, course_title: str, question: str, excerpts: list[Excerpt], history: list[Turn], level: str) -> str:
        system = prompts.TUTOR_SYSTEM.format(course=course_title, style=prompts.LEVEL_STYLE[level])
        user = prompts.tutor_user_message(question, [(e.ref, e.lecture_title, _when(e.start_seconds), e.text) for e in excerpts])
        messages = [{"role": t.role, "content": t.content} for t in history] + [{"role": "user", "content": user}]
        return await self._complete(model=self._s.llm_chat_model, system=system, messages=messages, max_tokens=self._s.llm_chat_max_tokens)

    async def summarize(self, *, title: str, transcript: str, level: str) -> SummaryOut:
        return await self._json(system=prompts.SUMMARY_SYSTEM.format(style=prompts.LEVEL_STYLE[level]), user=prompts.transcript_block(title, plain_text(transcript)), schema=SummaryOut)

    async def make_quiz(self, *, lecture_title: str, transcript: str, count: int, difficulty: str) -> QuizOut:
        system = prompts.QUIZ_SYSTEM.format(count=count, difficulty=difficulty)
        return await self._json(system=system, user=prompts.transcript_block(lecture_title, plain_text(transcript)), schema=QuizOut)

    async def make_flashcards(self, *, module_title: str, material: list[tuple[str, str]], count: int) -> list[CardOut]:
        user = "\n\n".join(prompts.transcript_block(title, plain_text(text)[: MAX_TRANSCRIPT_CHARS // max(1, len(material))]) for title, text in material)
        out = await self._json(system=prompts.FLASHCARDS_SYSTEM.format(module=module_title, count=count), user=user, schema=CardsOut)
        return out.cards[:count]

    async def make_study_plan(self, *, facts: dict) -> PlanOut:
        return await self._json(system=prompts.PLAN_SYSTEM, user=prompts.plan_user_message(facts), schema=PlanOut)
