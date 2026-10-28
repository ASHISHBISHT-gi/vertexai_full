import { env } from "../../config/env";
import { pool, withTransaction, type Db } from "../../db/pool";
import type { AuthUser, Role } from "../../middleware/auth";
import { removeFile } from "../../storage/storage";
import { AppError, notFound } from "../../utils/errors";
import { notify } from "../notifications/notifications.service";
import { audit } from "../shared/audit";

const pagination = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
const like = (q?: string) => (q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null);

// ------------------------------------------------------------------------------------------------ users
export async function listUsers(f: { q?: string; role?: string; status?: string; page: number; limit: number }) {
  const where = `($1::text IS NULL OR u.full_name ILIKE $1 OR u.email ILIKE $1)
    AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = $2))
    AND ($3::boolean IS NULL OR u.is_active = $3)`;
  const params = [like(f.q), f.role ?? null, f.status ? f.status === "active" : null];
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT u.id, u.full_name, u.email, u.is_active, u.created_at,
              COALESCE((SELECT array_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS roles,
              (SELECT count(*)::int FROM courses c WHERE c.instructor_id = u.id) AS course_count,
              (SELECT count(*)::int FROM enrollments e WHERE e.user_id = u.id) AS enrollment_count
       FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
      [...params, f.limit, (f.page - 1) * f.limit],
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM users u WHERE ${where}`, params),
  ]);
  return { data: rows.rows, pagination: pagination(f.page, f.limit, count.rows[0]!.n) };
}

async function lockUser(db: Db, id: string) {
  const { rows } = await db.query<{ id: string; full_name: string; email: string; is_active: boolean }>(
    "SELECT id, full_name, email, is_active FROM users WHERE id = $1 FOR UPDATE", [id],
  );
  if (!rows[0]) throw notFound("User");
  return rows[0];
}

async function rolesOf(db: Db, id: string): Promise<Role[]> {
  const { rows } = await db.query<{ name: Role }>("SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name", [id]);
  return rows.map((r) => r.name);
}

/** Other ADMINS who could still log in. The platform must always have at least one. */
async function otherActiveAdmins(db: Db, excludeId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.name = 'admin' AND u.is_active AND u.id <> $1`, [excludeId],
  );
  return rows[0]!.n;
}

export async function setRoles(actor: AuthUser, targetId: string, roles: Role[]) {
  const unique = [...new Set(roles)];
  return withTransaction(async (db) => {
    const target = await lockUser(db, targetId);
    const before = await rolesOf(db, targetId);
    const losingAdmin = before.includes("admin") && !unique.includes("admin");
    if (losingAdmin && actor.id === targetId) throw new AppError(400, "VALIDATION_ERROR", "You can't remove your own admin role. Ask another admin to do it.", "roles");
    if (losingAdmin && (await otherActiveAdmins(db, targetId)) === 0) throw new AppError(400, "VALIDATION_ERROR", "That would leave the platform without an admin.", "roles");

    await db.query("DELETE FROM user_roles WHERE user_id = $1", [targetId]);
    await db.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = ANY($2::text[])", [targetId, unique]);
    await audit(db, actor.id, "user.roles_changed", "user", targetId, { email: target.email, from: before, to: unique });
    await notify(db, [targetId], { type: "account", title: "Your account type changed", body: `You now have: ${unique.join(", ")}. It applies fully the next time you sign in.`, link: "/notifications" });
    return { id: targetId, roles: unique };
  });
}

export async function setSuspended(actor: AuthUser, targetId: string, suspended: boolean, reason?: string) {
  return withTransaction(async (db) => {
    const target = await lockUser(db, targetId);
    if (suspended) {
      if (actor.id === targetId) throw new AppError(400, "VALIDATION_ERROR", "You can't suspend your own account.");
      if ((await rolesOf(db, targetId)).includes("admin") && (await otherActiveAdmins(db, targetId)) === 0) {
        throw new AppError(400, "VALIDATION_ERROR", "That would leave the platform without an active admin.");
      }
    }
    await db.query("UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1", [targetId, !suspended]);
    // Signing in is blocked for suspended accounts; this also stops an already-signed-in session from renewing itself.
    if (suspended) await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [targetId]);
    await audit(db, actor.id, suspended ? "user.suspended" : "user.reactivated", "user", targetId, { email: target.email, reason: reason ?? null });
    return { id: targetId, is_active: !suspended };
  });
}

export async function deleteUser(actor: AuthUser, targetId: string, confirmEmail: string) {
  const files: (string | null)[] = [];
  await withTransaction(async (db) => {
    const target = await lockUser(db, targetId);
    if (actor.id === targetId) throw new AppError(400, "VALIDATION_ERROR", "You can't delete your own account.");
    if (confirmEmail.toLowerCase() !== target.email.toLowerCase()) throw new AppError(400, "VALIDATION_ERROR", "Type the user's email exactly to confirm.", "confirm_email");
    if ((await rolesOf(db, targetId)).includes("admin") && (await otherActiveAdmins(db, targetId)) === 0) {
      throw new AppError(400, "VALIDATION_ERROR", "That would leave the platform without an admin.");
    }
    const owned = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM courses WHERE instructor_id = $1", [targetId]);
    if (owned.rows[0]!.n > 0) {
      throw new AppError(409, "CONFLICT", `This user owns ${owned.rows[0]!.n} course(s). Their students' work depends on them, so archive or reassign those first, or suspend the account instead.`);
    }
    // Files on disk belong to rows that are about to disappear: remember them, delete them after the commit.
    const subs = await db.query<{ file_path: string }>("SELECT file_path FROM assignment_submissions WHERE user_id = $1", [targetId]);
    const certs = await db.query<{ file_path: string }>("SELECT file_path FROM certificates WHERE user_id = $1", [targetId]);
    files.push(...subs.rows.map((r) => r.file_path), ...certs.rows.map((r) => r.file_path));

    await audit(db, actor.id, "user.deleted", "user", targetId, { email: target.email, name: target.full_name });
    await db.query("DELETE FROM users WHERE id = $1", [targetId]); // everything the student owns cascades away
  });
  await Promise.all(files.map((f) => removeFile(f)));
}

// ------------------------------------------------------------------------------------------------ courses
export async function listCourses(f: { status?: string; q?: string; page: number; limit: number }) {
  const where = "($1::text IS NULL OR c.status = $1) AND ($2::text IS NULL OR c.title ILIKE $2 OR u.full_name ILIKE $2)";
  const params = [f.status ?? null, like(f.q)];
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT c.id, c.title, c.category, c.difficulty, c.price::float8 AS price, c.status, c.created_at,
              u.full_name AS instructor_name, u.email AS instructor_email,
              (SELECT count(*)::int FROM modules m WHERE m.course_id = c.id) AS module_count,
              (SELECT count(*)::int FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id) AS lecture_count,
              (SELECT count(*)::int FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id AND (l.video_path IS NOT NULL OR l.video_url IS NOT NULL)) AS video_count,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS enrollment_count,
              (SELECT ca.comment FROM course_approvals ca WHERE ca.course_id = c.id ORDER BY ca.reviewed_at DESC LIMIT 1) AS last_review_comment
       FROM courses c JOIN users u ON u.id = c.instructor_id
       WHERE ${where}
       ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT $3 OFFSET $4`,
      [...params, f.limit, (f.page - 1) * f.limit],
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM courses c JOIN users u ON u.id = c.instructor_id WHERE ${where}`, params),
  ]);
  return { data: rows.rows, pagination: pagination(f.page, f.limit, count.rows[0]!.n) };
}

// ------------------------------------------------------------------------------------------------ analytics
export async function overview() {
  const tz = env.APP_TIMEZONE;
  const today = "(now() AT TIME ZONE $1::text)::date";
  const [totals, byStatus, roles, enrollSeries, signupSeries, aiSeries, topCourses] = await Promise.all([
    pool.query(
      `SELECT (SELECT count(*)::int FROM users) AS users_total,
              (SELECT count(*)::int FROM users WHERE NOT is_active) AS users_suspended,
              (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_users_7d,
              (SELECT count(*)::int FROM streaks WHERE last_active_date = ${today}) AS active_today,
              (SELECT count(*)::int FROM streaks WHERE last_active_date >= ${today} - 6) AS active_7d,
              (SELECT count(*)::int FROM enrollments) AS enrollments_total,
              (SELECT count(*)::int FROM enrollments WHERE enrolled_at > now() - interval '7 days') AS enrollments_7d,
              (SELECT count(*)::int FROM enrollments WHERE progress_percent >= 100) AS completed_enrollments,
              (SELECT COALESCE(SUM(c.price), 0)::float8 FROM enrollments e JOIN courses c ON c.id = e.course_id) AS estimated_revenue,
              (SELECT count(*)::int FROM certificates) AS certificates_issued,
              (SELECT count(*)::int FROM ai_chat_messages WHERE sender = 'user' AND created_at > now() - interval '7 days') AS tutor_questions_7d`,
      [tz],
    ),
    pool.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM courses GROUP BY status"),
    pool.query<{ role: string; n: number }>("SELECT r.name AS role, count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id GROUP BY r.name"),
    series("enrollments", "enrolled_at", tz),
    series("users", "created_at", tz),
    pool.query("SELECT day::date::text AS day, COALESCE(n, 0)::int AS n FROM generate_series(((now() AT TIME ZONE $1::text)::date - 13), (now() AT TIME ZONE $1::text)::date, '1 day') AS day LEFT JOIN (SELECT (created_at AT TIME ZONE $1::text)::date AS d, count(*) AS n FROM ai_chat_messages WHERE sender = 'user' GROUP BY 1) x ON x.d = day::date ORDER BY day", [tz]),
    pool.query(
      `SELECT c.id, c.title, u.full_name AS instructor_name, count(e.id)::int AS enrollments,
              COALESCE(ROUND(AVG(e.progress_percent), 1), 0)::float8 AS avg_progress,
              (SELECT ROUND(AVG(rating), 2)::float8 FROM course_reviews r WHERE r.course_id = c.id) AS rating
       FROM courses c JOIN users u ON u.id = c.instructor_id LEFT JOIN enrollments e ON e.course_id = c.id
       WHERE c.status = 'approved' GROUP BY c.id, u.full_name ORDER BY enrollments DESC, c.title LIMIT 5`,
    ),
  ]);
  const t = totals.rows[0];
  return {
    ...t,
    completion_rate: t.enrollments_total ? Math.round((t.completed_enrollments / t.enrollments_total) * 1000) / 10 : 0,
    courses_by_status: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
    users_by_role: Object.fromEntries(roles.rows.map((r) => [r.role, r.n])),
    enrollments_per_day: enrollSeries.rows,
    signups_per_day: signupSeries.rows,
    tutor_questions_per_day: aiSeries.rows,
    top_courses: topCourses.rows,
    timezone: tz,
  };
}

/** One row per day for the last 14 days, INCLUDING days with zero: generate_series makes the days, LEFT JOIN fills the counts. */
function series(table: "enrollments" | "users", column: "enrolled_at" | "created_at", tz: string) {
  return pool.query(
    `SELECT day::date::text AS day, COALESCE(x.n, 0)::int AS n
     FROM generate_series(((now() AT TIME ZONE $1::text)::date - 13), (now() AT TIME ZONE $1::text)::date, '1 day') AS day
     LEFT JOIN (SELECT (${column} AT TIME ZONE $1::text)::date AS d, count(*) AS n FROM ${table} GROUP BY 1) x ON x.d = day::date
     ORDER BY day`,
    [tz],
  );
}

// ------------------------------------------------------------------------------------------------ audit log
export async function listAudit(f: { action?: string; page: number; limit: number }) {
  const where = "($1::text IS NULL OR a.action LIKE $1)";
  const params = [f.action ? `${f.action}%` : null];
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.metadata, a.created_at, u.full_name AS actor_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where} ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`,
      [...params, f.limit, (f.page - 1) * f.limit],
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs a WHERE ${where}`, params),
  ]);
  return { data: rows.rows, pagination: pagination(f.page, f.limit, count.rows[0]!.n) };
}
