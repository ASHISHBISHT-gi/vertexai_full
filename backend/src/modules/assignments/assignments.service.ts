import path from "node:path";
import { pool, withTransaction } from "../../db/pool";
import type { AuthUser } from "../../middleware/auth";
import { absolutePath, removeFile } from "../../storage/storage";
import { AppError, conflict, forbidden, notFound } from "../../utils/errors";
import { touchStreak } from "../gamification/gamification.service";
import { notify } from "../notifications/notifications.service";
import { assertCanManage, canManage, getEnrollment, requireEnrollment } from "../shared/access";

interface AssignmentInput {
  course_id: string; title: string; instructions?: string;
  rubric?: { criterion: string; points: number }[]; due_date?: string; max_points?: number;
}

async function getAssignment(id: string) {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.due_date, a.max_points, a.course_id, c.instructor_id
     FROM assignments a JOIN courses c ON c.id = a.course_id WHERE a.id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound("Assignment");
  return rows[0] as { id: string; title: string; due_date: Date | null; max_points: number; course_id: string; instructor_id: string };
}

export async function createAssignment(user: AuthUser, input: AssignmentInput) {
  const course = await pool.query("SELECT instructor_id FROM courses WHERE id = $1", [input.course_id]);
  if (!course.rows[0]) throw notFound("Course");
  assertCanManage(course.rows[0].instructor_id, user);
  const { rows } = await pool.query(
    `INSERT INTO assignments (course_id, title, instructions, rubric, due_date, max_points)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, course_id, title, instructions, rubric, due_date, max_points, created_at`,
    [input.course_id, input.title, input.instructions ?? null, input.rubric ? JSON.stringify(input.rubric) : null, input.due_date ?? null, input.max_points ?? 100],
  );
  return rows[0];
}

export async function deleteAssignment(id: string, user: AuthUser) {
  const a = await getAssignment(id);
  assertCanManage(a.instructor_id, user);
  const files = await pool.query("SELECT file_path FROM assignment_submissions WHERE assignment_id = $1", [id]);
  await pool.query("DELETE FROM assignments WHERE id = $1", [id]);
  await Promise.all(files.rows.map((f) => removeFile(f.file_path)));
}

/** Students get their own submission status; the course owner gets submission counts. */
export async function listCourseAssignments(courseId: string, user: AuthUser) {
  const course = await pool.query("SELECT instructor_id FROM courses WHERE id = $1", [courseId]);
  if (!course.rows[0]) throw notFound("Course");

  if (canManage(user, course.rows[0].instructor_id)) {
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.instructions, a.rubric, a.due_date, a.max_points,
              (SELECT count(*)::int FROM assignment_submissions s WHERE s.assignment_id = a.id) AS submission_count,
              (SELECT count(*)::int FROM assignment_submissions s WHERE s.assignment_id = a.id AND s.grade IS NULL) AS ungraded_count
       FROM assignments a WHERE a.course_id = $1 ORDER BY a.due_date NULLS LAST, a.created_at`,
      [courseId],
    );
    return rows;
  }

  await requireEnrollment(user.id, courseId);
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.instructions, a.rubric, a.due_date, a.max_points,
            (a.due_date IS NOT NULL AND a.due_date < now()) AS is_past_due,
            s.id AS submission_id, s.original_name, s.submitted_at, s.grade::float8 AS grade, s.feedback
     FROM assignments a
     LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.user_id = $2
     WHERE a.course_id = $1 ORDER BY a.due_date NULLS LAST, a.created_at`,
    [courseId, user.id],
  );
  return rows.map(({ submission_id, original_name, submitted_at, grade, feedback, ...a }) => ({
    ...a,
    status: grade !== null ? "graded" : submission_id ? "submitted" : "missing",
    submission: submission_id ? { id: submission_id, original_name, submitted_at, grade, feedback } : null,
  }));
}

/** Runs BEFORE the file upload middleware, so a rejected request never writes a file. */
export async function assertCanSubmit(assignmentId: string, user: AuthUser) {
  const a = await getAssignment(assignmentId);
  if (!(await getEnrollment(pool, user.id, a.course_id))) throw forbidden("Enroll in this course first");
  if (a.due_date && a.due_date.getTime() < Date.now()) throw new AppError(400, "DEADLINE_PASSED", "The deadline for this assignment has passed");
  const graded = await pool.query("SELECT 1 FROM assignment_submissions WHERE assignment_id = $1 AND user_id = $2 AND grade IS NOT NULL", [assignmentId, user.id]);
  if (graded.rowCount) throw conflict("This submission has already been graded");
}

export async function submit(assignmentId: string, user: AuthUser, file: { relative: string; original_name: string; size: number }) {
  return withTransaction(async (db) => {
    const old = await db.query("SELECT file_path FROM assignment_submissions WHERE assignment_id = $1 AND user_id = $2", [assignmentId, user.id]);
    const { rows } = await db.query(
      `INSERT INTO assignment_submissions (assignment_id, user_id, file_path, original_name, file_size)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (assignment_id, user_id) DO UPDATE SET
         file_path = EXCLUDED.file_path, original_name = EXCLUDED.original_name,
         file_size = EXCLUDED.file_size, submitted_at = now()
       WHERE assignment_submissions.grade IS NULL
       RETURNING id, original_name, submitted_at`,
      [assignmentId, user.id, file.relative, path.basename(file.original_name).slice(0, 200), file.size],
    );
    if (!rows[0]) throw conflict("This submission has already been graded");
    await touchStreak(db, user.id);
    if (old.rows[0]) await removeFile(old.rows[0].file_path); // resubmitting replaces the previous file
    return rows[0];
  });
}

export async function listSubmissions(assignmentId: string, user: AuthUser) {
  const a = await getAssignment(assignmentId);
  assertCanManage(a.instructor_id, user);
  const { rows } = await pool.query(
    `SELECT s.id, u.full_name AS student_name, u.email AS student_email, s.original_name, s.file_size,
            s.submitted_at, s.grade::float8 AS grade, s.feedback
     FROM assignment_submissions s JOIN users u ON u.id = s.user_id
     WHERE s.assignment_id = $1 ORDER BY s.submitted_at`,
    [assignmentId],
  );
  return rows;
}

async function getSubmission(id: string) {
  const { rows } = await pool.query(
    `SELECT s.id, s.user_id, s.file_path, s.original_name, a.max_points, a.title AS assignment_title, a.course_id, c.instructor_id
     FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id
     WHERE s.id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound("Submission");
  return rows[0] as { id: string; user_id: string; file_path: string; original_name: string; max_points: number; assignment_title: string; course_id: string; instructor_id: string };
}

/** The student who submitted it, the course owner, or an admin. Nobody else. */
export async function getSubmissionFile(id: string, user: AuthUser) {
  const s = await getSubmission(id);
  if (s.user_id !== user.id && !canManage(user, s.instructor_id)) throw forbidden();
  return { path: absolutePath(s.file_path), downloadName: s.original_name };
}

export async function gradeSubmission(id: string, user: AuthUser, input: { grade: number; feedback?: string }) {
  const s = await getSubmission(id);
  assertCanManage(s.instructor_id, user);
  if (input.grade > s.max_points) throw new AppError(400, "VALIDATION_ERROR", `grade can't be more than ${s.max_points}`, "grade");
  const { rows } = await pool.query(
    `UPDATE assignment_submissions SET grade = $2, feedback = $3, graded_at = now()
     WHERE id = $1 RETURNING id, grade::float8 AS grade, feedback, graded_at`,
    [id, input.grade, input.feedback ?? null],
  );
  await notify(pool, [s.user_id], {
    type: "grade", title: `"${s.assignment_title}" was graded`, body: `You scored ${input.grade} out of ${s.max_points}.${input.feedback ? " Feedback: " + input.feedback : ""}`,
    link: `/learn/${s.course_id}?tab=assignments`,
    email: true,
  });
  return rows[0];
}
