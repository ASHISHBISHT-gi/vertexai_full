"""
Login + permission checks. The Node API signs the login token; we verify it with the same secret.
(Video-link tokens have an `aud` claim and no roles, so they are rejected here.)
"""
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, Header

from app.core import db
from app.core.config import get_settings
from app.core.errors import forbidden, not_found, unauthorized


@dataclass
class CurrentUser:
    id: str
    roles: list[str]

    @property
    def is_admin(self) -> bool:
        return "admin" in self.roles


async def current_user(authorization: Annotated[str | None, Header()] = None) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized()
    try:
        payload = jwt.decode(
            authorization[7:], get_settings().jwt_access_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]}
        )
    except jwt.PyJWTError:
        raise unauthorized("Invalid or expired token") from None
    roles = payload.get("roles")
    if not isinstance(roles, list):
        raise unauthorized("Invalid token")
    return CurrentUser(id=str(payload["sub"]), roles=[str(r) for r in roles])


User = Annotated[CurrentUser, Depends(current_user)]


def require_role(user: CurrentUser, *roles: str) -> None:
    if not any(r in user.roles for r in roles):
        raise forbidden()


async def get_lecture(lecture_id: UUID) -> dict:
    row = await db.fetch_one(
        """SELECT l.id, l.title, l.transcript, l.module_id, l.indexed_at, l.indexed_chunks,
                  m.title AS module_title, c.id AS course_id, c.title AS course_title, c.instructor_id
           FROM lectures l JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id
           WHERE l.id = %s""",
        (lecture_id,),
    )
    if not row:
        raise not_found("Lecture")
    return row


async def get_course(course_id: UUID) -> dict:
    row = await db.fetch_one("SELECT id, title, instructor_id, status FROM courses WHERE id = %s", (course_id,))
    if not row:
        raise not_found("Course")
    return row


async def is_enrolled(user_id: str, course_id: UUID | str) -> bool:
    return await db.fetch_one("SELECT 1 AS ok FROM enrollments WHERE user_id = %s AND course_id = %s", (user_id, course_id)) is not None


async def require_member(user: CurrentUser, course: dict) -> None:
    """Enrolled students, plus the course's own instructor (who reviews the tutor). Admins are not members."""
    if str(course["instructor_id"]) == user.id:
        return
    if "student" in user.roles and await is_enrolled(user.id, course["id"]):
        return
    raise forbidden("Enroll in this course first")


def require_owner(user: CurrentUser, course_instructor_id) -> None:
    if str(course_instructor_id) != user.id and not user.is_admin:
        raise forbidden("You can only manage your own courses")
