"""Summaries, flashcards, AI quiz drafts and study plans."""
import hashlib
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.core import db
from app.core.auth import User, get_course, get_lecture, require_member, require_owner, require_role
from app.core.config import get_settings
from app.core.errors import AppError, not_found
from app.core.ratelimit import limiter
from app.llm import get_llm
from app.llm.schemas import QuizOut

router = APIRouter()
Level = Literal["beginner", "intermediate", "advanced"]


def _need_transcript(lecture: dict) -> str:
    text = (lecture["transcript"] or "").strip()
    if not text:
        raise AppError(422, "NO_TRANSCRIPT", "This lecture doesn't have a transcript yet.")
    return text


def _limit(user, per_minute: int = 10) -> None:
    limiter.check(f"gen:{user.id}", per_minute)


# ------------------------------------------------------------------------------------ summaries
class SummarizeBody(BaseModel):
    level: Level = "intermediate"


@router.post("/lectures/{lecture_id}/summarize")
async def summarize(lecture_id: UUID, user: User, body: SummarizeBody | None = None):
    level = (body or SummarizeBody()).level
    lecture = await get_lecture(lecture_id)
    await require_member(user, {"id": lecture["course_id"], "instructor_id": lecture["instructor_id"]})
    transcript = _need_transcript(lecture)
    llm = get_llm()

    # Same lecture + level + transcript + AI provider = same answer, so reuse it instead of paying again.
    digest = hashlib.sha256(f"{llm.name}:{transcript}".encode()).hexdigest()
    cached = await db.fetch_one(
        "SELECT summary, key_points FROM ai_summaries WHERE lecture_id = %s AND level = %s AND transcript_hash = %s", (lecture_id, level, digest)
    )
    if cached:
        return {"summary": cached["summary"], "key_points": cached["key_points"], "level": level, "cached": True, "demo": llm.is_demo}

    _limit(user)
    out = await llm.summarize(title=lecture["title"], transcript=transcript, level=level)
    await db.execute(
        """INSERT INTO ai_summaries (lecture_id, level, transcript_hash, summary, key_points) VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (lecture_id, level) DO UPDATE SET transcript_hash = EXCLUDED.transcript_hash,
             summary = EXCLUDED.summary, key_points = EXCLUDED.key_points, created_at = now()""",
        (lecture_id, level, digest, out.summary, Jsonb(out.key_points)),
    )
    return {"summary": out.summary, "key_points": out.key_points, "level": level, "cached": False, "demo": llm.is_demo}


# ------------------------------------------------------------------------------------ AI quiz draft
class GenerateQuizBody(BaseModel):
    num_questions: int = Field(5, ge=3, le=10)
    difficulty: Literal["easy", "medium", "hard"] = "medium"


def _clean_quiz(out: QuizOut, count: int) -> list[dict]:
    """AI output is untrusted: trim to what the Node API accepts and what the instructor asked for."""
    questions = []
    for q in out.questions[:count]:
        item: dict = {"question_text": q.question_text.strip()[:2000], "question_type": q.question_type, "points": max(1, min(q.points, 5))}
        if q.question_type == "short_answer":
            answers = list(dict.fromkeys(a.strip().lower()[:200] for a in q.accepted_answers if a.strip()))
            if answers:
                item["accepted_answers"] = answers[:10]
        else:
            item["options"] = [{"option_text": o.option_text.strip()[:500], "is_correct": o.is_correct} for o in q.options[:8]]
        questions.append(item)
    return questions


@router.post("/lectures/{lecture_id}/generate-quiz")
async def generate_quiz(lecture_id: UUID, user: User, body: GenerateQuizBody | None = None):
    """Returns a DRAFT. Nothing is saved: the instructor reviews and edits it in the quiz builder, then saves it."""
    body = body or GenerateQuizBody()
    require_role(user, "instructor", "admin")
    lecture = await get_lecture(lecture_id)
    require_owner(user, lecture["instructor_id"])
    transcript = _need_transcript(lecture)
    _limit(user)
    llm = get_llm()
    out = await llm.make_quiz(lecture_title=lecture["title"], transcript=transcript, count=body.num_questions, difficulty=body.difficulty)
    return {
        "title": out.title.strip()[:200], "module_id": lecture["module_id"], "generated_from_lecture_id": lecture["id"],
        "is_ai_generated": True, "demo": llm.is_demo, "questions": _clean_quiz(out, body.num_questions),
    }


# ------------------------------------------------------------------------------------ flashcards
class FlashcardsBody(BaseModel):
    count: int = Field(10, ge=5, le=20)
    regenerate: bool = False


async def _module(module_id: UUID) -> dict:
    row = await db.fetch_one(
        "SELECT m.id, m.title, c.id AS course_id, c.instructor_id FROM modules m JOIN courses c ON c.id = m.course_id WHERE m.id = %s", (module_id,)
    )
    if not row:
        raise not_found("Module")
    return row


@router.get("/modules/{module_id}/flashcards")
async def list_flashcards(module_id: UUID, user: User):
    mod = await _module(module_id)
    await require_member(user, {"id": mod["course_id"], "instructor_id": mod["instructor_id"]})
    return {"cards": await db.fetch_all("SELECT id, question, answer FROM flashcards WHERE module_id = %s ORDER BY created_at, id", (module_id,))}


@router.post("/modules/{module_id}/flashcards")
async def make_flashcards(module_id: UUID, user: User, body: FlashcardsBody | None = None):
    """Cards belong to the module, not to one student: the first request generates them, everyone then shares them."""
    body = body or FlashcardsBody()
    mod = await _module(module_id)
    await require_member(user, {"id": mod["course_id"], "instructor_id": mod["instructor_id"]})
    if body.regenerate:
        require_owner(user, mod["instructor_id"])

    existing = await db.fetch_all("SELECT id, question, answer FROM flashcards WHERE module_id = %s ORDER BY created_at, id", (module_id,))
    if existing and not body.regenerate:
        return {"cards": existing, "generated": False, "demo": get_llm().is_demo}

    material = [(r["title"], r["transcript"]) for r in await db.fetch_all(
        "SELECT title, transcript FROM lectures WHERE module_id = %s AND transcript IS NOT NULL AND transcript <> '' ORDER BY order_index", (module_id,))]
    if not material:
        raise AppError(422, "NO_TRANSCRIPT", "None of this module's lectures have a transcript yet.")
    _limit(user)
    llm = get_llm()
    cards = await llm.make_flashcards(module_title=mod["title"], material=material, count=body.count)
    async with db.transaction() as conn:
        await conn.execute("DELETE FROM flashcards WHERE module_id = %s", (module_id,))
        for c in cards:
            await conn.execute("INSERT INTO flashcards (module_id, question, answer) VALUES (%s, %s, %s)", (module_id, c.question.strip()[:1000], c.answer.strip()[:1000]))
    saved = await db.fetch_all("SELECT id, question, answer FROM flashcards WHERE module_id = %s ORDER BY created_at, id", (module_id,))
    return {"cards": saved, "generated": True, "demo": llm.is_demo}


# ------------------------------------------------------------------------------------ study plan
class PlanBody(BaseModel):
    course_id: UUID


async def _plan_facts(user_id: str, course: dict) -> dict:
    """The FACTS are computed by ordinary code. The AI only turns them into advice, so it can't invent your grades."""
    modules = await db.fetch_all(
        """SELECT m.id AS module_id, m.title,
                  (SELECT count(*)::int FROM lectures l WHERE l.module_id = m.id) AS lectures_total,
                  (SELECT count(*)::int FROM lectures l JOIN lecture_progress lp ON lp.lecture_id = l.id
                     JOIN enrollments e ON e.id = lp.enrollment_id
                    WHERE l.module_id = m.id AND e.user_id = %s AND lp.completed) AS lectures_completed,
                  tm.score::float8 AS mastery, COALESCE(tm.evidence_count, 0) AS quiz_attempts
           FROM modules m LEFT JOIN topic_mastery tm ON tm.module_id = m.id AND tm.user_id = %s
           WHERE m.course_id = %s ORDER BY m.order_index""",
        (user_id, user_id, course["id"]),
    )
    enrollment = await db.fetch_one("SELECT progress_percent::float8 AS p FROM enrollments WHERE user_id = %s AND course_id = %s", (user_id, course["id"]))
    assignments = await db.fetch_all(
        """SELECT a.title, to_char(a.due_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS due_date
           FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.user_id = %s
           WHERE a.course_id = %s AND s.id IS NULL AND (a.due_date IS NULL OR a.due_date > now())
           ORDER BY a.due_date NULLS LAST LIMIT 5""",
        (user_id, course["id"]),
    )
    return {
        "course": course["title"], "progress_percent": (enrollment or {"p": 0})["p"],
        "modules": [{**m, "module_id": str(m["module_id"]), "mastery": None if m["mastery"] is None else round(m["mastery"], 1)} for m in modules],
        "upcoming_assignments": [{"title": a["title"], "due_date": a["due_date"] or "no deadline"} for a in assignments],
    }


@router.post("/study-plan")
async def create_study_plan(body: PlanBody, user: User):
    require_role(user, "student")
    course = await get_course(body.course_id)
    await require_member(user, course)
    facts = await _plan_facts(user.id, course)
    if not facts["modules"]:
        raise AppError(422, "NO_CONTENT", "This course has no modules to plan around yet.")
    _limit(user)
    llm = get_llm()
    out = await llm.make_study_plan(facts=facts)
    known = {m["module_id"] for m in facts["modules"]}
    plan = {
        "summary": out.summary.strip()[:600],
        "steps": [{**s.model_dump(), "module_id": s.module_id if s.module_id in known else None} for s in out.steps],
    }
    row = await db.fetch_one("INSERT INTO study_plans (user_id, course_id, plan_json) VALUES (%s, %s, %s) RETURNING generated_at", (user.id, body.course_id, Jsonb(plan)))
    return {"plan": plan, "generated_at": row["generated_at"], "demo": llm.is_demo}


@router.get("/study-plan")
async def latest_study_plan(course_id: UUID, user: User):
    row = await db.fetch_one(
        "SELECT plan_json, generated_at FROM study_plans WHERE user_id = %s AND course_id = %s ORDER BY generated_at DESC LIMIT 1", (user.id, course_id)
    )
    return {"plan": row["plan_json"], "generated_at": row["generated_at"]} if row else {"plan": None, "generated_at": None}
