from contextlib import asynccontextmanager
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import get_settings

pool: AsyncConnectionPool | None = None


async def open_pool() -> None:
    global pool
    pool = AsyncConnectionPool(get_settings().database_url, min_size=1, max_size=10, open=False, kwargs={"row_factory": dict_row})
    await pool.open(wait=True, timeout=15)


async def close_pool() -> None:
    if pool:
        await pool.close()


async def fetch_all(sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
    assert pool is not None, "database pool is not open"
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params)
        return await cur.fetchall()


async def fetch_one(sql: str, params: tuple | list = ()) -> dict[str, Any] | None:
    rows = await fetch_all(sql, params)
    return rows[0] if rows else None


async def execute(sql: str, params: tuple | list = ()) -> None:
    assert pool is not None, "database pool is not open"
    async with pool.connection() as conn:
        await conn.execute(sql, params)


@asynccontextmanager
async def transaction():
    """`async with transaction() as conn:` - everything inside commits together, or not at all."""
    assert pool is not None, "database pool is not open"
    async with pool.connection() as conn:
        async with conn.transaction():
            yield conn
