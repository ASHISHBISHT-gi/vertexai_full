from typing import Protocol

from app.llm.schemas import CardOut, Excerpt, PlanOut, QuizOut, SummaryOut, Turn

LEVELS = ("beginner", "intermediate", "advanced")


class TutorLLM(Protocol):
    """Everything the app asks an AI to do. Claude answers for real; FakeLLM answers by rules (demo mode)."""

    name: str
    is_demo: bool

    async def answer(self, *, course_title: str, question: str, excerpts: list[Excerpt], history: list[Turn], level: str) -> str: ...
    async def summarize(self, *, title: str, transcript: str, level: str) -> SummaryOut: ...
    async def make_quiz(self, *, lecture_title: str, transcript: str, count: int, difficulty: str) -> QuizOut: ...
    async def make_flashcards(self, *, module_title: str, material: list[tuple[str, str]], count: int) -> list[CardOut]: ...
    async def make_study_plan(self, *, facts: dict) -> PlanOut: ...
