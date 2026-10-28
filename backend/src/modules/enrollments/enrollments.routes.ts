import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { authenticate, requireRole } from "../../middleware/auth";
import { conflict, notFound } from "../../utils/errors";

const router = Router();
const uuid = z.string().uuid("id must be a valid UUID");

router.post("/courses/:id/enroll", authenticate, requireRole("student"), async (req, res) => {
  const courseId = uuid.parse(req.params.id);

  const course = await pool.query("SELECT status FROM courses WHERE id = $1", [courseId]);
  if (course.rows[0]?.status !== "approved") throw notFound("Course");

  const { rows } = await pool.query(
    `INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)
     ON CONFLICT (user_id, course_id) DO NOTHING
     RETURNING id, course_id, enrolled_at, progress_percent::float8 AS progress_percent`,
    [req.user!.id, courseId],
  );
  if (!rows[0]) throw conflict("You are already enrolled in this course");
  res.status(201).json(rows[0]);
});

router.get("/enrollments/me", authenticate, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.id, e.enrolled_at, e.progress_percent::float8 AS progress_percent,
            c.id AS course_id, c.title, c.thumbnail_url, c.category, c.difficulty,
            u.full_name AS instructor_name
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     JOIN users u ON u.id = c.instructor_id
     WHERE e.user_id = $1
     ORDER BY e.enrolled_at DESC`,
    [req.user!.id],
  );
  res.json(
    rows.map(({ course_id, title, thumbnail_url, category, difficulty, instructor_name, ...enrollment }) => ({
      ...enrollment,
      course: { id: course_id, title, thumbnail_url, category, difficulty, instructor_name },
    })),
  );
});

export default router;
