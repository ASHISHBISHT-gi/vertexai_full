import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { pool, withTransaction } from "../../db/pool";
import type { AuthUser } from "../../middleware/auth";
import { forbidden, notFound } from "../../utils/errors";
import { issueCertificateIfComplete } from "../certificates/certificates.service";
import { touchStreak } from "../gamification/gamification.service";
import { canManage, getEnrollment, getLectureContext, requireEnrollment } from "../shared/access";

// ---------- course outline for the player ----------

export async function getLearnOutline(courseId: string, user: AuthUser) {
  const course = await pool.query("SELECT id, title, status, instructor_id FROM courses WHERE id = $1", [courseId]);
  if (!course.rows[0]) throw notFound("Course");
  const enrollment = await getEnrollment(pool, user.id, courseId);
  const isPreview = !enrollment;
  if (isPreview && !canManage(user, course.rows[0].instructor_id)) throw forbidden("Enroll in this course first");

  const { rows } = await pool.query(
    `SELECT m.id AS module_id, m.title AS module_title, m.order_index AS module_order,
            l.id, l.title, l.duration_seconds, l.order_index,
            (l.video_path IS NOT NULL OR l.video_url IS NOT NULL) AS has_video,
            COALESCE(lp.position_seconds, 0) AS position_seconds,
            COALESCE(lp.completed, false) AS completed, lp.last_watched_at
     FROM modules m
     LEFT JOIN lectures l ON l.module_id = m.id
     LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id AND lp.enrollment_id = $2
     WHERE m.course_id = $1
     ORDER BY m.order_index, l.order_index`,
    [courseId, enrollment?.id ?? null],
  );

  const modules: { id: string; title: string; lectures: any[] }[] = [];
  for (const r of rows) {
    let mod = modules.find((m) => m.id === r.module_id);
    if (!mod) modules.push((mod = { id: r.module_id, title: r.module_title, lectures: [] }));
    if (r.id) {
      mod.lectures.push({
        id: r.id, title: r.title, duration_seconds: r.duration_seconds, has_video: r.has_video,
        position_seconds: r.position_seconds, completed: r.completed,
      });
    }
  }

  // Resume where the student left off: the most recently watched unfinished lecture,
  // otherwise the first unfinished one, otherwise the very first lecture.
  const flat = rows.filter((r) => r.id);
  const recent = flat.filter((r) => r.last_watched_at && !r.completed)
    .sort((a, b) => +new Date(b.last_watched_at) - +new Date(a.last_watched_at))[0];
  const resume = recent ?? flat.find((r) => !r.completed) ?? flat[0];

  let certificate: { id: string; code: string } | null = null;
  if (enrollment) {
    if (enrollment.progress_percent >= 100) await issueCertificateIfComplete(user.id, courseId).catch((e) => console.error("certificate failed", e));
    const c = await pool.query("SELECT id, code FROM certificates WHERE user_id = $1 AND course_id = $2", [user.id, courseId]);
    certificate = c.rows[0] ?? null;
  }

  return {
    course: { id: course.rows[0].id, title: course.rows[0].title, status: course.rows[0].status },
    enrollment, is_preview: isPreview, modules, resume_lecture_id: resume?.id ?? null, certificate,
  };
}

// ---------- signed video links ----------
// <video src="..."> can't send an Authorization header, so we hand out a short-lived signed link instead.

export async function createPlayback(lectureId: string, user: AuthUser) {
  const lec = await getLectureContext(lectureId);
  if (!canManage(user, lec.instructor_id)) await requireEnrollment(user.id, lec.course_id);
  if (!lec.video_path && !lec.video_url) throw notFound("Video");
  if (!lec.video_path) return { url: lec.video_url!, expires_in: null, external: true };

  const token = jwt.sign({ lec: lectureId }, env.JWT_ACCESS_SECRET, {
    subject: user.id, audience: "media", expiresIn: env.MEDIA_TOKEN_TTL_SECONDS, algorithm: "HS256",
  });
  return { url: `/media/lectures/${lectureId}?token=${token}`, expires_in: env.MEDIA_TOKEN_TTL_SECONDS, external: false };
}

export async function getVideoFileForToken(lectureId: string, token: string) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { audience: "media", algorithms: ["HS256"] });
  if (typeof payload === "string" || payload.lec !== lectureId) throw new Error("token is for a different lecture");
  const lec = await getLectureContext(lectureId);
  if (!lec.video_path) throw notFound("Video");
  return { relative: lec.video_path, mime: lec.video_mime ?? "video/mp4" };
}

// ---------- progress ----------

export async function saveProgress(lectureId: string, user: AuthUser, input: { position_seconds: number; completed?: boolean }) {
  const lec = await getLectureContext(lectureId);
  const enrollment = await requireEnrollment(user.id, lec.course_id);

  const duration = lec.duration_seconds ?? 0;
  const position = duration > 0 ? Math.min(input.position_seconds, duration) : input.position_seconds;
  // A lecture counts as finished at 90% of its length, or when the student says so.
  const completedNow = input.completed === true || (duration > 0 && position >= duration * 0.9);

  const result = await withTransaction(async (db) => {
    const row = await db.query(
      `INSERT INTO lecture_progress (enrollment_id, lecture_id, position_seconds, watched_seconds, completed, last_watched_at)
       VALUES ($1, $2, $3, $3, $4, now())
       ON CONFLICT (enrollment_id, lecture_id) DO UPDATE SET
         position_seconds = EXCLUDED.position_seconds,
         watched_seconds  = GREATEST(lecture_progress.watched_seconds, EXCLUDED.watched_seconds),
         completed        = lecture_progress.completed OR EXCLUDED.completed,
         last_watched_at  = now()
       RETURNING position_seconds, completed`,
      [enrollment.id, lectureId, position, completedNow],
    );
    // progress_percent = finished lectures / all lectures in the course
    const pct = await db.query(
      `UPDATE enrollments e SET progress_percent = COALESCE((
         SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE lp.completed) / NULLIF(COUNT(*), 0), 2)
         FROM lectures l JOIN modules m ON m.id = l.module_id
         LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id AND lp.enrollment_id = e.id
         WHERE m.course_id = e.course_id), 0)
       WHERE e.id = $1 RETURNING progress_percent::float8 AS progress_percent`,
      [enrollment.id],
    );
    const streak = await touchStreak(db, user.id);
    return { ...row.rows[0], progress_percent: pct.rows[0].progress_percent as number, streakBadge: streak.newBadge };
  });

  const newBadges: string[] = result.streakBadge ? [result.streakBadge] : [];
  let certificate: { id: string } | null = null;
  if (result.progress_percent >= 100) {
    try {
      const cert = await issueCertificateIfComplete(user.id, lec.course_id);
      if (cert) certificate = { id: cert.id };
      if (cert?.badge) newBadges.push(cert.badge);
    } catch (err) {
      console.error("certificate generation failed", err); // progress is saved either way; retried on the next visit
    }
  }
  return {
    position_seconds: result.position_seconds as number, completed: result.completed as boolean,
    progress_percent: result.progress_percent, certificate, new_badges: newBadges,
  };
}

// ---------- notes & bookmarks ----------

export async function listNotes(lectureId: string, user: AuthUser) {
  const lec = await getLectureContext(lectureId);
  await requireEnrollment(user.id, lec.course_id);
  const { rows } = await pool.query(
    "SELECT id, timestamp_seconds, content, created_at FROM notes WHERE user_id = $1 AND lecture_id = $2 ORDER BY timestamp_seconds, created_at",
    [user.id, lectureId],
  );
  return rows;
}

export async function addNote(lectureId: string, user: AuthUser, input: { timestamp_seconds: number; content: string }) {
  const lec = await getLectureContext(lectureId);
  await requireEnrollment(user.id, lec.course_id);
  const { rows } = await pool.query(
    "INSERT INTO notes (user_id, lecture_id, timestamp_seconds, content) VALUES ($1, $2, $3, $4) RETURNING id, timestamp_seconds, content, created_at",
    [user.id, lectureId, input.timestamp_seconds, input.content],
  );
  return rows[0];
}

export async function deleteNote(noteId: string, user: AuthUser) {
  // The user_id in WHERE means you can only ever delete your own notes.
  const { rowCount } = await pool.query("DELETE FROM notes WHERE id = $1 AND user_id = $2", [noteId, user.id]);
  if (!rowCount) throw notFound("Note");
}

export async function listBookmarks(lectureId: string, user: AuthUser) {
  const lec = await getLectureContext(lectureId);
  await requireEnrollment(user.id, lec.course_id);
  const { rows } = await pool.query(
    "SELECT id, timestamp_seconds, created_at FROM bookmarks WHERE user_id = $1 AND lecture_id = $2 ORDER BY timestamp_seconds",
    [user.id, lectureId],
  );
  return rows;
}

export async function addBookmark(lectureId: string, user: AuthUser, input: { timestamp_seconds: number }) {
  const lec = await getLectureContext(lectureId);
  await requireEnrollment(user.id, lec.course_id);
  const { rows } = await pool.query(
    "INSERT INTO bookmarks (user_id, lecture_id, timestamp_seconds) VALUES ($1, $2, $3) RETURNING id, timestamp_seconds, created_at",
    [user.id, lectureId, input.timestamp_seconds],
  );
  return rows[0];
}

export async function deleteBookmark(id: string, user: AuthUser) {
  const { rowCount } = await pool.query("DELETE FROM bookmarks WHERE id = $1 AND user_id = $2", [id, user.id]);
  if (!rowCount) throw notFound("Bookmark");
}

// ---------- mastery ----------

/** How well the student knows each topic (module) of a course, from their quiz results. score is null until they take a quiz there. */
export async function getMastery(courseId: string, user: AuthUser) {
  await requireEnrollment(user.id, courseId);
  const { rows } = await pool.query(
    `SELECT m.id AS module_id, m.title, tm.score::float8 AS score, COALESCE(tm.evidence_count, 0)::int AS evidence_count
     FROM modules m LEFT JOIN topic_mastery tm ON tm.module_id = m.id AND tm.user_id = $2
     WHERE m.course_id = $1 ORDER BY m.order_index`,
    [courseId, user.id],
  );
  return rows;
}
