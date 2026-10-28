"""Step 3 of RAG: store passages with their vectors, and find the ones closest in meaning to a question."""
from dataclasses import dataclass
from uuid import UUID

from app.core import db
from app.rag.chunking import chunk_transcript
from app.rag.embeddings import Embedder, to_pgvector


@dataclass
class Passage:
    lecture_id: str
    lecture_title: str
    module_id: str
    text: str
    start_seconds: int | None
    similarity: float


async def index_lecture(lecture: dict, embedder: Embedder) -> int:
    """(Re)builds one lecture's passages from its transcript. Returns how many passages were stored."""
    chunks = chunk_transcript(lecture.get("transcript") or "")
    # Embed first. If the embedding service fails, the old passages are still in place.
    vectors = await embedder.embed_documents([c.text for c in chunks])

    async with db.transaction() as conn:
        await conn.execute("DELETE FROM document_chunks WHERE lecture_id = %s", (lecture["id"],))
        for chunk, vec in zip(chunks, vectors, strict=True):
            await conn.execute(
                """INSERT INTO document_chunks (course_id, lecture_id, chunk_index, chunk_text, start_seconds, embedding)
                   VALUES (%s, %s, %s, %s, %s, %s::vector)""",
                (lecture["course_id"], lecture["id"], chunk.index, chunk.text, chunk.start_seconds, to_pgvector(vec)),
            )
        await conn.execute(
            "UPDATE lectures SET indexed_at = CASE WHEN %s > 0 THEN now() ELSE NULL END, indexed_chunks = %s WHERE id = %s",
            (len(chunks), len(chunks), lecture["id"]),
        )
    return len(chunks)


async def search(course_id: UUID | str, query_vector: list[float], k: int) -> list[Passage]:
    """`<=>` is pgvector's cosine DISTANCE (0 = identical direction); 1 - distance is the similarity."""
    vec = to_pgvector(query_vector)
    rows = await db.fetch_all(
        """SELECT dc.chunk_text, dc.start_seconds, dc.lecture_id, l.title AS lecture_title, l.module_id,
                  1 - (dc.embedding <=> %s::vector) AS similarity
           FROM document_chunks dc JOIN lectures l ON l.id = dc.lecture_id
           WHERE dc.course_id = %s
           ORDER BY dc.embedding <=> %s::vector
           LIMIT %s""",
        (vec, course_id, vec, k),
    )
    return [
        Passage(str(r["lecture_id"]), r["lecture_title"], str(r["module_id"]), r["chunk_text"], r["start_seconds"], float(r["similarity"]))
        for r in rows
    ]


async def course_has_passages(course_id: UUID | str) -> bool:
    return await db.fetch_one("SELECT 1 AS ok FROM document_chunks WHERE course_id = %s LIMIT 1", (course_id,)) is not None
