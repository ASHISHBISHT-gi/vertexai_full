import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { authenticate, requireRole } from "../../middleware/auth";
import { notFound } from "../../utils/errors";
import { assertCanManage } from "../shared/access";

const router = Router();

router.get("/instructor/courses/:id/analytics", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  const courseId = z.string().uuid().parse(req.params.id);
  const course = await pool.query("SELECT instructor_id, title FROM courses WHERE id = $1", [courseId]);
  if (!course.rows[0]) throw notFound("Course");
  assertCanManage(course.rows[0].instructor_id, req.user!);

  const [summary, lectures, quizzes, assignments] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS enrolled,
              count(*) FILTER (WHERE progress_percent >= 100)::int AS completed,
              COALESCE(ROUND(AVG(progress_percent), 1), 0)::float8 AS avg_progress,
              COALESCE((SELECT SUM(lp.watched_seconds) FROM lecture_progress lp JOIN enrollments e2 ON e2.id = lp.enrollment_id WHERE e2.course_id = $1), 0)::int AS total_watched_seconds
       FROM enrollments WHERE course_id = $1`,
      [courseId],
    ),
    // "started" vs "completed" per lecture is the drop-off view: where do students stop?
    pool.query(
      `SELECT l.id, l.title, m.title AS module_title, l.duration_seconds,
              count(lp.id) FILTER (WHERE lp.watched_seconds > 0 OR lp.completed)::int AS started,
              count(lp.id) FILTER (WHERE lp.completed)::int AS completed
       FROM lectures l JOIN modules m ON m.id = l.module_id
       LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id
       WHERE m.course_id = $1 GROUP BY l.id, m.id ORDER BY m.order_index, l.order_index`,
      [courseId],
    ),
    pool.query(
      `SELECT z.id, z.title, z.is_published,
              count(a.id) FILTER (WHERE a.submitted_at IS NOT NULL)::int AS attempts,
              count(DISTINCT a.user_id) FILTER (WHERE a.submitted_at IS NOT NULL)::int AS students,
              ROUND(AVG(a.score), 1)::float8 AS avg_score
       FROM quizzes z JOIN modules m ON m.id = z.module_id LEFT JOIN quiz_attempts a ON a.quiz_id = z.id
       WHERE m.course_id = $1 GROUP BY z.id, m.order_index ORDER BY m.order_index, z.created_at`,
      [courseId],
    ),
    pool.query(
      `SELECT a.id, a.title, a.max_points,
              count(s.id)::int AS submitted, count(s.grade)::int AS graded,
              ROUND(AVG(s.grade) * 100.0 / NULLIF(a.max_points, 0), 1)::float8 AS avg_grade_percent
       FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id = a.id
       WHERE a.course_id = $1 GROUP BY a.id ORDER BY a.created_at`,
      [courseId],
    ),
  ]);

  res.json({ course: { id: courseId, title: course.rows[0].title }, ...summary.rows[0], lectures: lectures.rows, quizzes: quizzes.rows, assignments: assignments.rows });
});

export default router;
