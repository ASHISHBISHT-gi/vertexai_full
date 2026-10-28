import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.core.ratelimit import RateLimiter
from app.llm.fake import FakeLLM
from app.llm.json_utils import extract_json
from app.llm.schemas import Excerpt, QuestionOut
from app.rag.store import Passage
from app.routers.chat import cited_sources
from app.routers.generate import _clean_quiz

TRANSCRIPT = """WEBVTT

00:00:00.000 --> 00:00:20.000
A LEFT JOIN keeps every row from the left table, even when there is no match on the right. Where there is no match, the right side columns come back as NULL.

00:00:20.000 --> 00:00:50.000
An INNER JOIN returns only the rows that have a match in both tables. Employees without a department are missing from an INNER JOIN result.

00:00:50.000 --> 00:01:30.000
To find rows that have no match, use a LEFT JOIN and then filter with WHERE the right id IS NULL. That returns every employee who is not assigned to any department.
"""


def passages(n=3):
    return [Passage(f"lec-{i}", f"Lecture {i}", "mod", f"text {i}", i * 10, 0.9) for i in range(1, n + 1)]


def test_citations_only_include_excerpts_the_ai_used_in_order_of_mention():
    src = cited_sources("First point [2]. Then another [1][3]. Again [2]. Bogus [9].", passages())
    assert [s["ref"] for s in src] == [2, 1, 3]
    assert src[0]["lecture_title"] == "Lecture 2" and src[0]["timestamp_seconds"] == 20


def test_citations_with_comma_lists_and_no_citations():
    assert [s["ref"] for s in cited_sources("Both [1, 2].", passages())] == [1, 2]
    assert cited_sources("I couldn't find that in the course.", passages()) == []


def test_extract_json_variants():
    assert extract_json('{"a": 1}') == {"a": 1}
    assert extract_json('Sure!\n```json\n{"a": {"b": [1, 2]}}\n```\nHope that helps') == {"a": {"b": [1, 2]}}
    with pytest.raises(ValueError):
        extract_json("no braces here")


def test_question_rules_match_the_node_api():
    opt = lambda t, c: {"option_text": t, "is_correct": c}  # noqa: E731
    QuestionOut(question_text="Which?", question_type="mcq", options=[opt("a", True), opt("b", False)])
    QuestionOut(question_text="Which?", question_type="multi_select", options=[opt("a", True), opt("b", True)])
    QuestionOut(question_text="Name it", question_type="short_answer", accepted_answers=["x"])
    for bad in (
        dict(question_type="mcq", options=[opt("a", True), opt("b", True)]),   # two correct
        dict(question_type="mcq", options=[opt("a", True)]),                    # one option
        dict(question_type="multi_select", options=[opt("a", False), opt("b", False)]),  # none correct
        dict(question_type="short_answer", options=[opt("a", True)]),           # options on a short answer
    ):
        with pytest.raises(ValidationError):
            QuestionOut(question_text="Question?", **bad)


def test_rate_limiter_blocks_the_21st_request_and_sets_retry_after():
    rl = RateLimiter()
    for _ in range(20):
        rl.check("u1", 20)
    with pytest.raises(AppError) as err:
        rl.check("u1", 20)
    assert err.value.status == 429 and int(err.value.headers["Retry-After"]) >= 1
    rl.check("u2", 20)  # other users are unaffected


async def test_fake_tutor_answers_from_excerpts_and_refuses_off_topic():
    llm = FakeLLM()
    ex = [Excerpt(ref=1, lecture_title="LEFT JOIN", start_seconds=0, text="A LEFT JOIN keeps every row from the left table. Merge sort splits arrays.")]
    ans = await llm.answer(course_title="SQL", question="What does a left join keep?", excerpts=ex, history=[], level="beginner")
    assert "[1]" in ans and "left table" in ans and ans.startswith("(Demo mode) In simple terms:")
    off = await llm.answer(course_title="SQL", question="Who won the cricket world cup?", excerpts=ex, history=[], level="intermediate")
    assert "couldn't find" in off and "[" not in off


async def test_fake_generators_produce_valid_output():
    llm = FakeLLM()
    quiz = await llm.make_quiz(lecture_title="Joins", transcript=TRANSCRIPT, count=3, difficulty="medium")
    assert len(quiz.questions) == 3 and "(demo)" in quiz.title
    cleaned = _clean_quiz(quiz, 3)
    for q in cleaned:
        if q["question_type"] == "mcq":
            assert sum(o["is_correct"] for o in q["options"]) == 1
        else:
            assert q["accepted_answers"]
    summary = await llm.summarize(title="Joins", transcript=TRANSCRIPT, level="intermediate")
    assert summary.key_points and summary.summary.startswith("(Demo mode)")
    cards = await llm.make_flashcards(module_title="Joins", material=[("Joins", TRANSCRIPT)], count=4)
    assert cards and all("_____" in c.question for c in cards)
    with pytest.raises(AppError) as err:
        await llm.make_quiz(lecture_title="x", transcript="Too short.", count=3, difficulty="easy")
    assert err.value.code == "TRANSCRIPT_TOO_SHORT"


async def test_fake_study_plan_puts_the_weakest_topic_first():
    facts = {"course": "SQL", "progress_percent": 40.0, "upcoming_assignments": [{"title": "Essay", "due_date": "2026-11-01"}],
             "modules": [{"module_id": "m1", "title": "Basics", "mastery": 90.0, "lectures_total": 2, "lectures_completed": 2, "quiz_attempts": 2},
                         {"module_id": "m2", "title": "Joins", "mastery": 35.0, "lectures_total": 2, "lectures_completed": 1, "quiz_attempts": 1}]}
    plan = await FakeLLM().make_study_plan(facts=facts)
    assert plan.steps[0].module_id == "m2" and "35" in plan.steps[0].why
    assert any(s.title.startswith("Submit Essay") for s in plan.steps)
