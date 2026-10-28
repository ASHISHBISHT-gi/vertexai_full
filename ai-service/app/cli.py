"""
Command-line helpers.   python -m app.cli index-all [--force]
`index-all` indexes every lecture that has a transcript but hasn't been indexed yet (--force: redo all).
"""
import asyncio
import sys

from app.core import db
from app.core.auth import get_lecture
from app.deps import get_embedder
from app.rag import store


async def index_all(force: bool) -> None:
    await db.open_pool()
    try:
        rows = await db.fetch_all(
            """SELECT id FROM lectures WHERE transcript IS NOT NULL AND transcript <> ''
               AND (%s OR indexed_at IS NULL OR indexed_at < transcript_updated_at) ORDER BY title""",
            (force,),
        )
        print(f"{len(rows)} lecture(s) to index with the '{get_embedder().name}' embedder")
        for r in rows:
            lecture = await get_lecture(r["id"])
            n = await store.index_lecture(lecture, get_embedder())
            print(f"  {lecture['course_title']} / {lecture['title']}: {n} passages")
    finally:
        await db.close_pool()


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "index-all":
        asyncio.run(index_all("--force" in sys.argv))
    else:
        print("usage: python -m app.cli index-all [--force]")
        sys.exit(1)
