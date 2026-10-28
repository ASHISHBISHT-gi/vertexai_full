import { env } from "../../config/env";
import { pool, withTransaction } from "../../db/pool";
import { cache } from "../../lib/ttlCache";
import type { AuthUser } from "../../middleware/auth";
import { notFound } from "../../utils/errors";
import { removeFile } from "../../storage/storage";
import { assertCanManage, canManage, getLectureContext, isAdmin } from "../shared/access";
import { notify } from "../notifications/notifications.service";
import { audit } from "../shared/audit";

// price is NUMERIC in Postgres, which node-pg returns as a string. Cast so the API returns a number.
const COURSE_COLUMNS = `c.id, c.instructor_id, c.title, c.description, c.category, c.difficulty,
  c.thumbnail_url, c.price::float8 AS price, c.status, c.created_at`;

export interface CourseInput {
  title: string;
  description?: string;
  category?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  thumbnail_url?: string;
  price?: number;
}

export interface CatalogFilters {
  q?: string;
  category?: string;
  difficulty?: string;
  min_rating?: number;
  page: number;
  limit: number;
}

export async function listCatalog(f: CatalogFilters) {
  // PRD 9.4: catalog pages are cached (5 min). Any course change calls invalidateCatalog(), so edits show up at once.
  return cache.remember(`catalog:${JSON.stringify(f)}`, env.CATALOG_CACHE_SECONDS, () => queryCatalog(f));
}

export const invalidateCatalog = () => cache.invalidatePrefix("catalog:");

async function queryCatalog(f: CatalogFilters) {
  // Escape LIKE wildcards so a search for "100%" matches literally.
  const pattern = f.q ? `%${f.q.replace(/[\\%_]/g, "\\$&")}%` : null;
  // Average rating per course, computed once and joined in. Courses nobody has rated count as 0 stars.
  const ratings = `LEFT JOIN (SELECT course_id, AVG(rating)::float8 AS avg, COUNT(*)::int AS cnt FROM course_reviews GROUP BY course_id) rv ON rv.course_id = c.id`;
  const where = `c.status = 'approved'
    AND ($1::text IS NULL OR c.category = $1)
    AND ($2::text IS NULL OR c.difficulty = $2)
    AND ($3::text IS NULL OR c.title ILIKE $3 OR c.description ILIKE $3)
    AND ($4::numeric IS NULL OR COALESCE(rv.avg, 0) >= $4)`;
  const filterParams = [f.category ?? null, f.difficulty ?? null, pattern, f.min_rating ?? null];

  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT ${COURSE_COLUMNS}, u.full_name AS instructor_name,
              COALESCE(rv.avg, 0)::float8 AS rating_avg, COALESCE(rv.cnt, 0)::int AS rating_count
       FROM courses c JOIN users u ON u.id = c.instructor_id ${ratings}
       WHERE ${where}
       ORDER BY c.created_at DESC
       LIMIT $5 OFFSET $6`,
      [...filterParams, f.limit, (f.page - 1) * f.limit],
    ),
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM courses c ${ratings} WHERE ${where}`, filterParams),
  ]);

  const total = count.rows[0]!.total;
  return {
    data: rows.rows,
    pagination: { page: f.page, limit: f.limit, total, totalPages: Math.max(1, Math.ceil(total / f.limit)) },
  };
}

export async function getCourseDetail(courseId: string, viewer?: AuthUser) {
  const { rows } = await pool.query(
    `SELECT ${COURSE_COLUMNS}, u.full_name AS instructor_name,
            (SELECT COALESCE(AVG(rating), 0)::float8 FROM course_reviews WHERE course_id = c.id) AS rating_avg,
            (SELECT count(*)::int FROM course_reviews WHERE course_id = c.id) AS rating_count
     FROM courses c JOIN users u ON u.id = c.instructor_id WHERE c.id = $1`,
    [courseId],
  );
  const course = rows[0];
  if (!course) throw notFound("Course");

  const isOwner = viewer?.id === course.instructor_id;
  const canManageCourse = isOwner || isAdmin(viewer);
  // Unapproved courses are invisible (404, not 403) to everyone except the owner and admins.
  if (course.status !== "approved" && !canManageCourse) throw notFound("Course");

  let enrolled = false;
  if (viewer) {
    const e = await pool.query("SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2", [viewer.id, courseId]);
    enrolled = (e.rowCount ?? 0) > 0;
  }
  // Anyone can see the course outline; only enrolled students/owners/admins get video + resource links.
  const canViewContent = canManageCourse || enrolled;

  const [modules, lectures] = await Promise.all([
    pool.query("SELECT id, title, order_index FROM modules WHERE course_id = $1 ORDER BY order_index", [courseId]),
    pool.query(
      `SELECT l.id, l.module_id, l.title, l.duration_seconds, l.order_index,
              (l.video_path IS NOT NULL OR l.video_url IS NOT NULL) AS has_video
              ${canViewContent ? ", l.video_url, l.resource_urls" : ""}
              ${canManageCourse ? ", (l.transcript IS NOT NULL AND l.transcript <> '') AS has_transcript, (l.indexed_at IS NOT NULL AND l.indexed_at >= l.transcript_updated_at) AS ai_indexed" : ""}
       FROM lectures l JOIN modules m ON m.id = l.module_id
       WHERE m.course_id = $1 ORDER BY l.order_index`,
      [courseId],
    ),
  ]);

  return {
    ...course,
    is_enrolled: enrolled,
    can_edit: canManageCourse,
    modules: modules.rows.map((m) => ({ ...m, lectures: lectures.rows.filter((l) => l.module_id === m.id) })),
  };
}

export async function createCourse(instructorId: string, input: CourseInput) {
  const { rows } = await pool.query(
    `INSERT INTO courses (instructor_id, title, description, category, difficulty, thumbnail_url, price)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, instructor_id, title, description, category, difficulty, thumbnail_url, price::float8 AS price, status, created_at`,
    [instructorId, input.title, input.description ?? null, input.category ?? null, input.difficulty ?? null, input.thumbnail_url ?? null, input.price ?? 0],
  );
  return rows[0];
}

const UPDATABLE = ["title", "description", "category", "difficulty", "thumbnail_url", "price"] as const;

export async function updateCourse(courseId: string, user: AuthUser, input: Partial<CourseInput>) {
  const existing = await pool.query("SELECT instructor_id FROM courses WHERE id = $1", [courseId]);
  if (!existing.rows[0]) throw notFound("Course");
  assertCanManage(existing.rows[0].instructor_id, user);

  // Column names come from the hard-coded UPDATABLE list above, never from user input.
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const col of UPDATABLE) {
    if (input[col] !== undefined) {
      values.push(input[col]);
      sets.push(`${col} = $${values.length}`);
    }
  }
  values.push(courseId);
  const { rows } = await pool.query(
    `UPDATE courses SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}
     RETURNING id, instructor_id, title, description, category, difficulty, thumbnail_url, price::float8 AS price, status, created_at`,
    values,
  );
  invalidateCatalog();
  return rows[0];
}

export async function listInstructorCourses(instructorId: string) {
  const { rows } = await pool.query(
    `SELECT ${COURSE_COLUMNS},
            (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS enrollment_count
     FROM courses c WHERE c.instructor_id = $1 ORDER BY c.created_at DESC`,
    [instructorId],
  );
  return rows;
}

export async function addModule(courseId: string, user: AuthUser, input: { title: string; order_index?: number }) {
  const course = await pool.query("SELECT instructor_id FROM courses WHERE id = $1", [courseId]);
  if (!course.rows[0]) throw notFound("Course");
  assertCanManage(course.rows[0].instructor_id, user);

  const { rows } = await pool.query(
    `INSERT INTO modules (course_id, title, order_index)
     VALUES ($1, $2, COALESCE($3::int, (SELECT COALESCE(MAX(order_index), -1) + 1 FROM modules WHERE course_id = $1)))
     RETURNING id, course_id, title, order_index`,
    [courseId, input.title, input.order_index ?? null],
  );
  return rows[0];
}

export interface LectureInput {
  title: string;
  video_url?: string;
  transcript?: string;
  duration_seconds?: number;
  resource_urls?: string[];
  order_index?: number;
}

export async function addLecture(moduleId: string, user: AuthUser, input: LectureInput) {
  const mod = await pool.query(
    `SELECT c.instructor_id FROM modules m JOIN courses c ON c.id = m.course_id WHERE m.id = $1`,
    [moduleId],
  );
  if (!mod.rows[0]) throw notFound("Module");
  assertCanManage(mod.rows[0].instructor_id, user);

  const { rows } = await pool.query(
    `INSERT INTO lectures (module_id, title, video_url, transcript, duration_seconds, resource_urls, order_index)
     VALUES ($1, $2, $3, $4, $5, $6,
             COALESCE($7::int, (SELECT COALESCE(MAX(order_index), -1) + 1 FROM lectures WHERE module_id = $1)))
     RETURNING id, module_id, title, video_url, duration_seconds, resource_urls, order_index`,
    [moduleId, input.title, input.video_url ?? null, input.transcript ?? null, input.duration_seconds ?? null, input.resource_urls ?? [], input.order_index ?? null],
  );
  return rows[0];
}

export async function decideCourse(courseId: string, adminId: string, input: { decision: "approved" | "rejected"; comment?: string }) {
  const result = await decide(courseId, adminId, input);
  invalidateCatalog(); // after the commit, so the next catalog read sees the new status
  return result;
}

async function decide(courseId: string, adminId: string, input: { decision: "approved" | "rejected"; comment?: string }) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      "UPDATE courses SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, title, status, instructor_id",
      [courseId, input.decision],
    );
    if (!rows[0]) throw notFound("Course");
    await db.query(
      "INSERT INTO course_approvals (course_id, reviewed_by, decision, comment) VALUES ($1, $2, $3, $4)",
      [courseId, adminId, input.decision, input.comment ?? null],
    );
    const { instructor_id, ...course } = rows[0];
    await audit(db, adminId, `course.${input.decision}`, "course", courseId, { title: course.title, comment: input.comment ?? null });
    await notify(db, [instructor_id], {
      type: "course_review",
      title: input.decision === "approved" ? `"${course.title}" is now published` : `"${course.title}" needs changes`,
      body: input.comment || (input.decision === "approved" ? "Students can now find and enroll in it." : undefined),
      link: `/teach/courses/${courseId}`,
      email: true,
    });
    return course;
  });
}

// ---------- lecture video + deletion ----------

/** Used BEFORE the upload middleware, so an unauthorised user can't make us write a big file to disk. */
export async function assertLectureOwner(lectureId: string, user: AuthUser) {
  const lec = await getLectureContext(lectureId);
  assertCanManage(lec.instructor_id, user);
}

export async function attachVideo(lectureId: string, user: AuthUser, file: { relative: string; mime: string }, durationSeconds?: number) {
  const lec = await getLectureContext(lectureId);
  assertCanManage(lec.instructor_id, user);
  const { rows } = await pool.query(
    `UPDATE lectures SET video_path = $2, video_mime = $3, video_url = NULL,
            duration_seconds = COALESCE($4::int, duration_seconds)
     WHERE id = $1 RETURNING id, title, duration_seconds, true AS has_video`,
    [lectureId, file.relative, file.mime, durationSeconds ?? null],
  );
  await removeFile(lec.video_path); // replace, don't pile up old files
  return rows[0];
}

export async function deleteLecture(lectureId: string, user: AuthUser) {
  const lec = await getLectureContext(lectureId);
  assertCanManage(lec.instructor_id, user);
  await pool.query("DELETE FROM lectures WHERE id = $1", [lectureId]);
  await removeFile(lec.video_path);
}

export async function deleteModule(moduleId: string, user: AuthUser) {
  const mod = await pool.query(
    `SELECT c.instructor_id, COALESCE(array_agg(l.video_path) FILTER (WHERE l.video_path IS NOT NULL), '{}') AS videos
     FROM modules m JOIN courses c ON c.id = m.course_id LEFT JOIN lectures l ON l.module_id = m.id
     WHERE m.id = $1 GROUP BY c.instructor_id`,
    [moduleId],
  );
  if (!mod.rows[0]) throw notFound("Module");
  assertCanManage(mod.rows[0].instructor_id, user);
  await pool.query("DELETE FROM modules WHERE id = $1", [moduleId]); // lectures, quizzes cascade
  await Promise.all((mod.rows[0].videos as string[]).map((v) => removeFile(v)));
}

// ---------- transcripts (the text the AI tutor learns from) ----------

export async function getTranscript(lectureId: string, user: AuthUser) {
  const lec = await getLectureContext(lectureId);
  assertCanManage(lec.instructor_id, user);
  const { rows } = await pool.query(
    `SELECT COALESCE(transcript, '') AS transcript, transcript_updated_at, indexed_at, indexed_chunks,
            (indexed_at IS NOT NULL AND indexed_at >= transcript_updated_at) AS ai_indexed
     FROM lectures WHERE id = $1`,
    [lectureId],
  );
  return rows[0];
}

/** Saves the text only. Turning it into AI-searchable passages is the AI service's job (POST /ai/lectures/:id/index). */
export async function saveTranscript(lectureId: string, user: AuthUser, transcript: string) {
  const lec = await getLectureContext(lectureId);
  assertCanManage(lec.instructor_id, user);
  const text = transcript.trim();
  if (!text) await pool.query("DELETE FROM document_chunks WHERE lecture_id = $1", [lectureId]); // cleared: forget it
  const { rows } = await pool.query(
    `UPDATE lectures SET transcript = $2, transcript_updated_at = now(),
            indexed_at = CASE WHEN $2::text IS NULL THEN NULL ELSE indexed_at END,
            indexed_chunks = CASE WHEN $2::text IS NULL THEN 0 ELSE indexed_chunks END
     WHERE id = $1
     RETURNING id, (transcript IS NOT NULL) AS has_transcript, false AS ai_indexed`,
    [lectureId, text || null],
  );
  return rows[0];
}
