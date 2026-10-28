import re
from typing import Literal
from uuid import UUID

from fastapi import APIRouter
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from app.core import db
from app.core.auth import User, get_course, require_member, require_role
from app.core.config import get_settings
from app.core.errors import not_found
from app.core.ratelimit import limiter
from app.deps import get_embedder
from app.llm import get_llm
from app.llm.schemas import Excerpt, Turn
from app.rag import store

router = APIRouter(prefix="/chat")
Mode = Literal["auto", "beginner", "intermediate", "advanced"]


class CreateSession(BaseModel):
    course_id: UUID
    mode: Mode = "auto"


class SendMessage(BaseModel):
    message: str = Field(min_length=1, max_length=2000)

    @field_validator("message")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Write a question first")
        return v.strip()


class SetMode(BaseModel):
    mode: Mode


async def _own_session(session_id: UUID, user) -> dict:
    row = await db.fetch_one(
        """SELECT s.id, s.user_id, s.course_id, s.mode, c.title AS course_title, c.instructor_id
           FROM ai_chat_sessions s JOIN courses c ON c.id = s.course_id WHERE s.id = %s""",
        (session_id,),
    )
    if not row or str(row["user_id"]) != user.id:
        raise not_found("Chat session")  # 404, not 403: don't reveal that other people's sessions exist
    return row


async def resolve_level(mode: str, module_id: str, user_id: str) -> str:
    """'auto' adapts to the student: struggling in this topic -> beginner explanations; strong -> advanced."""
    if mode != "auto":
        return mode
    row = await db.fetch_one("SELECT score::float8 AS score FROM topic_mastery WHERE user_id = %s AND module_id = %s", (user_id, module_id))
    if not row:
        return "intermediate"
    return "beginner" if row["score"] < 50 else "intermediate" if row["score"] < 80 else "advanced"


def cited_sources(reply: str, passages: list[store.Passage]) -> list[dict]:
    """The AI marks claims like [2]. We return only the excerpts it actually cited, in order of first mention."""
    refs: list[int] = []
    for m in re.finditer(r"\[(\d+(?:\s*,\s*\d+)*)\]", reply):
        for n in (int(x) for x in m.group(1).split(",")):
            if 1 <= n <= len(passages) and n not in refs:
                refs.append(n)
    return [
        {"ref": n, "lecture_id": passages[n - 1].lecture_id, "lecture_title": passages[n - 1].lecture_title,
         "timestamp_seconds": passages[n - 1].start_seconds, "snippet": passages[n - 1].text[:160]}
        for n in refs
    ]


@router.post("/sessions", status_code=201)
async def create_session(body: CreateSession, user: User):
    require_role(user, "student", "instructor")
    course = await get_course(body.course_id)
    await require_member(user, course)
    return await db.fetch_one(
        "INSERT INTO ai_chat_sessions (user_id, course_id, mode) VALUES (%s, %s, %s) RETURNING id, course_id, mode, created_at, updated_at",
        (user.id, body.course_id, body.mode),
    )


@router.get("/sessions")
async def list_sessions(course_id: UUID, user: User):
    return await db.fetch_all(
        """SELECT s.id, s.course_id, s.mode, s.created_at, s.updated_at,
                  (SELECT count(*)::int FROM ai_chat_messages m WHERE m.session_id = s.id) AS message_count
           FROM ai_chat_sessions s WHERE s.user_id = %s AND s.course_id = %s ORDER BY s.updated_at DESC LIMIT 20""",
        (user.id, course_id),
    )


@router.get("/sessions/{session_id}/messages")
async def list_messages(session_id: UUID, user: User):
    await _own_session(session_id, user)
    return await db.fetch_all(
        "SELECT id, sender, content, sources, created_at FROM ai_chat_messages WHERE session_id = %s ORDER BY created_at", (session_id,)
    )


@router.put("/sessions/{session_id}/mode")
async def set_mode(session_id: UUID, body: SetMode, user: User):
    await _own_session(session_id, user)
    return await db.fetch_one("UPDATE ai_chat_sessions SET mode = %s WHERE id = %s RETURNING id, mode", (body.mode, session_id))


@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: UUID, body: SendMessage, user: User):
    s = get_settings()
    limiter.check(f"chat:{user.id}", s.chat_rate_limit_per_minute)  # every message costs money: cap the rate
    session = await _own_session(session_id, user)
    await require_member(user, {"id": session["course_id"], "instructor_id": session["instructor_id"]})

    # --- recent conversation, so follow-ups like "can you explain that again?" make sense ---
    rows = await db.fetch_all(
        "SELECT sender, content FROM ai_chat_messages WHERE session_id = %s ORDER BY created_at DESC LIMIT %s", (session_id, s.chat_history_messages)
    )
    history = [Turn(role="user" if r["sender"] == "user" else "assistant", content=r["content"]) for r in reversed(rows)]
    while history and history[0].role != "user":
        history.pop(0)
    previous_question = next((t.content for t in reversed(history) if t.role == "user"), None)

    # --- 1. RETRIEVE: find the passages whose meaning is closest to the question ---
    # A short follow-up ("why?") means nothing alone, so we search with the previous question attached.
    search_text = body.message if len(body.message.split()) >= 8 or not previous_question else f"{previous_question} {body.message}"
    query_vector = await get_embedder().embed_query(search_text)
    passages = [p for p in await store.search(session["course_id"], query_vector, s.retrieval_top_k) if p.similarity >= s.min_similarity]

    level_used: str | None = None
    if not passages:
        indexed = await store.course_has_passages(session["course_id"])
        reply = (
            "I couldn't find anything about that in this course's material. Try rephrasing, or check the lecture list for the right topic."
            if indexed else
            "The AI tutor hasn't been set up for this course yet: none of its lectures have been indexed. Ask your instructor to add transcripts."
        )
        sources: list[dict] = []
    else:
        # --- 2. AUGMENT + 3. GENERATE: hand the AI the passages and the question, and let it answer from them ---
        level_used = await resolve_level(session["mode"], passages[0].module_id, user.id)
        excerpts = [Excerpt(ref=i + 1, lecture_title=p.lecture_title, start_seconds=p.start_seconds, text=p.text) for i, p in enumerate(passages)]
        reply = await get_llm().answer(course_title=session["course_title"], question=body.message, excerpts=excerpts, history=history, level=level_used)
        sources = cited_sources(reply, passages)

    # Both messages are saved together, and only after the AI succeeded: a failed call leaves no half-conversation.
    async with db.transaction() as conn:
        await conn.execute("INSERT INTO ai_chat_messages (session_id, sender, content, created_at) VALUES (%s, 'user', %s, clock_timestamp())", (session_id, body.message))
        cur = await conn.execute(
            "INSERT INTO ai_chat_messages (session_id, sender, content, sources, created_at) VALUES (%s, 'ai', %s, %s, clock_timestamp()) RETURNING id, created_at",
            (session_id, reply, Jsonb(sources)),
        )
        saved = await cur.fetchone()
        await conn.execute("UPDATE ai_chat_sessions SET updated_at = now() WHERE id = %s", (session_id,))

    return {"id": saved["id"], "reply": reply, "sources": sources, "mode": session["mode"], "level": level_used, "created_at": saved["created_at"]}
