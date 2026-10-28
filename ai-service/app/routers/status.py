from uuid import UUID

from fastapi import APIRouter

from app.core import db
from app.core.auth import User, get_course, get_lecture, require_member, require_owner, require_role
from app.core.config import get_settings
from app.core.errors import AppError
from app.deps import get_embedder
from app.llm import get_llm
from app.rag import store

router = APIRouter()


@router.get("/status")
async def provider_status():
    """Public. Lets the UI show a "demo mode" notice. Contains no secrets."""
    s = get_settings()
    return {
        "llm_provider": s.llm_provider, "embedding_provider": s.embedding_provider,
        "demo": s.demo_mode, "chat_model": s.llm_chat_model if s.llm_provider == "anthropic" else None,
    }


@router.get("/courses/{course_id}/status")
async def course_status(course_id: UUID, user: User):
    course = await get_course(course_id)
    await require_member(user, course)
    lectures = await db.fetch_all(
        """SELECT l.id, l.title, l.module_id, m.title AS module_title,
                  (l.transcript IS NOT NULL AND l.transcript <> '') AS has_transcript,
                  (l.indexed_at IS NOT NULL AND l.indexed_at >= l.transcript_updated_at) AS indexed, l.indexed_chunks AS chunks
           FROM lectures l JOIN modules m ON m.id = l.module_id
           WHERE m.course_id = %s ORDER BY m.order_index, l.order_index""",
        (course_id,),
    )
    return {"ready": any(l["indexed"] for l in lectures), "lectures": lectures}


@router.post("/lectures/{lecture_id}/index")
async def index_lecture(lecture_id: UUID, user: User):
    """Instructors: turn a saved transcript into AI-searchable passages (chunk -> embed -> store)."""
    require_role(user, "instructor", "admin")
    lecture = await get_lecture(lecture_id)
    require_owner(user, lecture["instructor_id"])
    if not (lecture["transcript"] or "").strip():
        raise AppError(422, "NO_TRANSCRIPT", "Save a transcript for this lecture first.")
    chunks = await store.index_lecture(lecture, get_embedder())
    return {"lecture_id": lecture_id, "chunks": chunks, "indexed": chunks > 0, "provider": get_embedder().name, "llm": get_llm().name}
