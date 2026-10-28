import { pool } from "../../db/pool";
import { invalidateCatalog } from "../courses/courses.service";
import type { AuthUser } from "../../middleware/auth";
import { audit } from "../shared/audit";
import { canManage, getEnrollment, isAdmin } from "../shared/access";
import { forbidden, notFound } from "../../utils/errors";

async function visibleCourse(courseId: string, viewer?: AuthUser) {
  const { rows } = await pool.query<{ id: string; status: string; instructor_id: string }>("SELECT id, status, instructor_id FROM courses WHERE id = $1", [courseId]);
  const course = rows[0];
  if (!course || (course.status !== "approved" && !canManage(viewer, course.instructor_id))) throw notFound("Course");
  return course;
}

/** "Ananya Sharma" -> "Ananya S.": enough to feel human, not enough to identify someone. */
const shortName = `split_part(u.full_name, ' ', 1) || CASE WHEN position(' ' in u.full_name) > 0 THEN ' ' || left(split_part(u.full_name, ' ', 2), 1) || '.' ELSE '' END`;

export async function listReviews(courseId: string, viewer: AuthUser | undefined, page: number, limit: number) {
  await visibleCourse(courseId, viewer);
  const [summary, items] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS count, COALESCE(ROUND(AVG(rating), 2), 0)::float8 AS average,
              count(*) FILTER (WHERE rating = 1)::int AS r1, count(*) FILTER (WHERE rating = 2)::int AS r2,
              count(*) FILTER (WHERE rating = 3)::int AS r3, count(*) FILTER (WHERE rating = 4)::int AS r4,
              count(*) FILTER (WHERE rating = 5)::int AS r5
       FROM course_reviews WHERE course_id = $1`, [courseId],
    ),
    pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, (${shortName}) AS author_name,
              COALESCE(r.user_id = $2, false) AS mine  -- COALESCE: a visitor with no id would otherwise give NULL, not false
       FROM course_reviews r JOIN users u ON u.id = r.user_id WHERE r.course_id = $1
       ORDER BY COALESCE(r.user_id = $2, false) DESC, r.created_at DESC LIMIT $3 OFFSET $4`,
      [courseId, viewer?.id ?? null, limit, (page - 1) * limit],
    ),
  ]);
  const s = summary.rows[0];
  return {
    summary: { average: s.average, count: s.count, distribution: { 1: s.r1, 2: s.r2, 3: s.r3, 4: s.r4, 5: s.r5 } },
    items: items.rows,
    can_review: viewer ? !!(await getEnrollment(pool, viewer.id, courseId)) && viewer.roles.includes("student") : false,
  };
}

export async function saveReview(courseId: string, user: AuthUser, input: { rating: number; comment?: string }) {
  await visibleCourse(courseId, user);
  if (!user.roles.includes("student") || !(await getEnrollment(pool, user.id, courseId))) throw forbidden("Only students enrolled in this course can review it");
  // INSERT ... ON CONFLICT: writing a second review simply updates the first (one review per student per course).
  const { rows } = await pool.query(
    `INSERT INTO course_reviews (course_id, user_id, rating, comment) VALUES ($1, $2, $3, $4)
     ON CONFLICT (course_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()
     RETURNING id, rating, comment, created_at, updated_at`,
    [courseId, user.id, input.rating, input.comment?.trim() || null],
  );
  invalidateCatalog(); // the catalog shows average ratings
  return rows[0];
}

export async function deleteReview(reviewId: string, user: AuthUser) {
  const { rows } = await pool.query<{ id: string; user_id: string; course_id: string }>("SELECT id, user_id, course_id FROM course_reviews WHERE id = $1", [reviewId]);
  const review = rows[0];
  if (!review) throw notFound("Review");
  if (review.user_id !== user.id && !isAdmin(user)) throw forbidden("You can only delete your own review");
  await pool.query("DELETE FROM course_reviews WHERE id = $1", [reviewId]);
  invalidateCatalog();
  if (review.user_id !== user.id) await audit(pool, user.id, "review.removed", "review", reviewId, { course_id: review.course_id, author_id: review.user_id });
}
