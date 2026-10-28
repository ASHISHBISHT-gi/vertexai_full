"""What the AI tasks take in and give back. Pydantic checks every AI answer, because model output is untrusted input."""
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Excerpt(BaseModel):
    ref: int                      # the number the AI uses to cite it: [1], [2]...
    lecture_title: str
    start_seconds: int | None
    text: str


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class SummaryOut(BaseModel):
    summary: str = Field(min_length=1)
    key_points: list[str] = Field(min_length=1, max_length=10)


class OptionOut(BaseModel):
    option_text: str = Field(min_length=1)
    is_correct: bool


class QuestionOut(BaseModel):
    question_text: str = Field(min_length=3)
    question_type: Literal["mcq", "multi_select", "short_answer"]
    points: int = 1
    options: list[OptionOut] = []
    accepted_answers: list[str] = []

    # The same rules the Node API enforces when a quiz is saved. Checking here lets us ask the AI to fix its mistake.
    @model_validator(mode="after")
    def _rules(self):
        correct = sum(o.is_correct for o in self.options)
        if self.question_type == "mcq":
            if len(self.options) < 2:
                raise ValueError("a multiple-choice question needs at least 2 options")
            if correct != 1:
                raise ValueError("a multiple-choice question needs exactly 1 correct option")
        elif self.question_type == "multi_select":
            if len(self.options) < 2:
                raise ValueError("a multi-select question needs at least 2 options")
            if correct < 1:
                raise ValueError("a multi-select question needs at least 1 correct option")
        elif self.options:
            raise ValueError("a short-answer question must not have options")
        return self


class QuizOut(BaseModel):
    title: str = Field(min_length=3)
    questions: list[QuestionOut] = Field(min_length=1)


class CardOut(BaseModel):
    question: str = Field(min_length=3)
    answer: str = Field(min_length=1)


class CardsOut(BaseModel):
    cards: list[CardOut] = Field(min_length=1)


class PlanStepOut(BaseModel):
    title: str = Field(min_length=3)
    why: str = Field(min_length=3)
    action: str = Field(min_length=3)
    estimated_minutes: int = Field(ge=5, le=240)
    module_id: str | None = None


class PlanOut(BaseModel):
    summary: str = Field(min_length=3)
    steps: list[PlanStepOut] = Field(min_length=1, max_length=8)
