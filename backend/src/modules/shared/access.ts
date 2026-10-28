/** Small permission helpers used by several modules. */
import { pool, type Db } from "../../db/pool";
import type { AuthUser } from "../../middleware/auth";
import { forbidden, notFound } from "../../utils/errors";

export const isAdmin = (user?: AuthUser) => user?.roles.includes("admin") ?? false;

/** Owner of the course, or an admin. */
export const canManage = (user: AuthUser | undefined, instructorId: string) =>
  !!user && (user.id === instructorId || isAdmin(user));

export function assertCanManage(instructorId: string, user: AuthUser) {
  if (!canManage(user, instructorId)) throw forbidden("You can only manage your own courses");
}

export async function getEnrollment(db: Db, userId: string, courseId: string) {
  const { rows } = await db.query<{ id: string; progress_percent: number }>(
    "SELECT id, progress_percent::float8 AS progress_percent FROM enrollments WHERE user_id = $1 AND course_id = $2",
    [userId, courseId],
  );
  return rows[0] ?? null;
}

export async function requireEnrollment(userId: string, courseId: string) {
  const enrollment = await getEnrollment(pool, userId, courseId);
  if (!enrollment) throw forbidden("Enroll in this course first");
  return enrollment;
}

/** Which course (and owner) does this lecture belong to? */
export async function getLectureContext(lectureId: string) {
  const { rows } = await pool.query<{
    id: string; title: string; duration_seconds: number | null; video_path: string | null;
    video_mime: string | null; video_url: string | null; module_id: string; course_id: string; instructor_id: string; course_status: string;
  }>(
    `SELECT l.id, l.title, l.duration_seconds, l.video_path, l.video_mime, l.video_url, l.module_id,
            c.id AS course_id, c.instructor_id, c.status AS course_status
     FROM lectures l JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id
     WHERE l.id = $1`,
    [lectureId],
  );
  if (!rows[0]) throw notFound("Lecture");
  return rows[0];
}

/** "Ananya Sharma" -> "Ananya S.": a friendly public name that doesn't give away the full identity. `alias` is the users table alias. */
export const shortNameSql = (alias: string) =>
  `(split_part(${alias}.full_name, ' ', 1) || CASE WHEN position(' ' in ${alias}.full_name) > 0 THEN ' ' || left(split_part(${alias}.full_name, ' ', 2), 1) || '.' ELSE '' END)`;

/**
 * Who may take part in a course's community (forum, announcements, leaderboard)?
 * The owner and admins, plus students enrolled in it. Unapproved courses stay invisible (404) to everyone else.
 * `manager` = owner or admin: they can moderate.
 */
export async function requireCourseMember(courseId: string, user: AuthUser) {
  const { rows } = await pool.query<{ id: string; title: string; status: string; instructor_id: string }>(
    "SELECT id, title, status, instructor_id FROM courses WHERE id = $1",
    [courseId],
  );
  const course = rows[0];
  if (!course) throw notFound("Course");
  const manager = canManage(user, course.instructor_id);
  if (!manager) {
    if (course.status !== "approved") throw notFound("Course");
    if (!(await getEnrollment(pool, user.id, courseId))) throw forbidden("Enroll in this course to see its community");
  }
  return { course, manager };
}
