import { pool, withTransaction } from "../../db/pool";
import type { AuthUser } from "../../middleware/auth";
import { forbidden, notFound } from "../../utils/errors";
import { notify } from "../notifications/notifications.service";
import { requireCourseMember } from "../shared/access";

const pagination = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });

export async function list(courseId: string, user: AuthUser, page: number, limit: number) {
  const { manager } = await requireCourseMember(courseId, user);
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT a.id, a.title, a.content, a.created_at, COALESCE(u.full_name, 'Instructor') AS posted_by_name
       FROM announcements a LEFT JOIN users u ON u.id = a.posted_by WHERE a.course_id = $1 ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`,
      [courseId, limit, (page - 1) * limit],
    ),
    pool.query<{ n: number }>("SELECT count(*)::int AS n FROM announcements WHERE course_id = $1", [courseId]),
  ]);
  return { data: rows.rows, pagination: pagination(page, limit, count.rows[0]!.n), can_post: manager };
}

/** Posts the announcement, then tells every enrolled student in the app and by email — in one transaction. */
export async function create(courseId: string, user: AuthUser, input: { title: string; content: string }) {
  const { course, manager } = await requireCourseMember(courseId, user);
  if (!manager) throw forbidden("Only the course's instructor can post announcements");
  return withTransaction(async (db) => {
    const { rows } = await db.query("INSERT INTO announcements (course_id, posted_by, title, content) VALUES ($1, $2, $3, $4) RETURNING id, title, content, created_at", [courseId, user.id, input.title, input.content]);
    const students = await db.query<{ user_id: string }>("SELECT user_id FROM enrollments WHERE course_id = $1", [courseId]);
    await notify(db, students.rows.map((s) => s.user_id), {
      type: "announcement", title: `${course.title}: ${input.title}`, body: input.content.length > 300 ? input.content.slice(0, 297) + "..." : input.content,
      link: `/learn/${courseId}?tab=community`, email: true,
    });
    return { ...rows[0], notified: students.rows.length };
  });
}

export async function remove(id: string, user: AuthUser) {
  const { rows } = await pool.query<{ course_id: string }>("SELECT course_id FROM announcements WHERE id = $1", [id]);
  if (!rows[0]) throw notFound("Announcement");
  const { manager } = await requireCourseMember(rows[0].course_id, user);
  if (!manager) throw forbidden("Only the course's instructor can delete announcements");
  await pool.query("DELETE FROM announcements WHERE id = $1", [id]);
}
