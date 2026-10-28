"""
A simple "N requests per minute per user" limiter, kept in memory.
It exists because every chat message costs real money. Limits: it forgets on restart and isn't shared between
several server copies. Fine for one server. With several copies, swap this class for Redis (same check() method).
"""
import time
from collections import defaultdict, deque

from app.core.errors import AppError


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window_seconds: float = 60.0) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            retry_after = max(1, int(window_seconds - (now - hits[0])) + 1)
            raise AppError(429, "RATE_LIMITED", "You're asking questions very quickly. Wait a few seconds and try again.", headers={"Retry-After": str(retry_after)})
        hits.append(now)

    def reset(self) -> None:
        self._hits.clear()


limiter = RateLimiter()
