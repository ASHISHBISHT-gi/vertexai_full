import { pool, withTransaction } from "../../db/pool";
import type { AuthUser } from "../../middleware/auth";
import { AppError, forbidden, notFound } from "../../utils/errors";
import { notify } from "../notifications/notifications.service";
import { audit } from "../shared/audit";
import { requireCourseMember, shortNameSql } from "../shared/access";

const MAX_POSTS_PER_THREAD = 1000;
const pagination = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
const like = (q?: string) => (q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null);
const excerpt = (s: string) => (s.length > 140 ? s.slice(0, 137) + "..." : s);

interface ThreadContext {
  id: string; title: string; created_by: string | null; is_pinned: boolean;
  course_id: string; course_title: string; instructor_id: string;
}

async function getThread(threadId: string): Promise<ThreadContext> {
  const { rows } = await pool.query<ThreadContext>(
    `SELECT t.id, t.title, t.created_by, t.is_pinned, c.id AS course_id, c.title AS course_title, c.instructor_id
     FROM discussion_threads t JOIN courses c ON c.id = t.course_id WHERE t.id = $1`,
    [threadId],
  );
  if (!rows[0]) throw notFound("Thread");
  return rows[0];
}

interface PostContext {
  id: string; user_id: string | null; content: string; thread_id: string; thread_title: string;
  course_id: string; instructor_id: string; is_opening: boolean;
}

async function getPost(postId: string): Promise<PostContext> {
  const { rows } = await pool.query<PostContext>(
    `SELECT p.id, p.user_id, p.content, p.thread_id, t.title AS thread_title, c.id AS course_id, c.instructor_id,
            p.id = (SELECT p2.id FROM discussion_posts p2 WHERE p2.thread_id = p.thread_id ORDER BY p2.created_at, p2.id LIMIT 1) AS is_opening
     FROM discussion_posts p JOIN discussion_threads t ON t.id = p.thread_id JOIN courses c ON c.id = t.course_id WHERE p.id = $1`,
    [postId],
  );
  if (!rows[0]) throw notFound("Post");
  return rows[0];
}

// ------------------------------------------------------------------------------------------------ threads
export async function listThreads(courseId: string, user: AuthUser, f: { q?: string; page: number; limit: number }) {
  const { manager } = await requireCourseMember(courseId, user);
  const where = "t.course_id = $1 AND ($2::text IS NULL OR t.title ILIKE $2)";
  const params = [courseId, like(f.q)];
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT t.id, t.title, t.is_pinned, t.created_at, t.last_activity_at,
              COALESCE(${shortNameSql("u")}, 'Deleted user') AS author_name, COALESCE(t.created_by = c.instructor_id, false) AS by_instructor,
              GREATEST((SELECT count(*)::int FROM discussion_posts p WHERE p.thread_id = t.id) - 1, 0) AS reply_count,
              EXISTS (SELECT 1 FROM discussion_posts p WHERE p.thread_id = t.id AND p.is_flagged) AS has_flagged
       FROM discussion_threads t JOIN courses c ON c.id = t.course_id LEFT JOIN users u ON u.id = t.created_by
       WHERE ${where} ORDER BY t.is_pinned DESC, t.last_activity_at DESC LIMIT $3 OFFSET $4`,
      [...params, f.limit, (f.page - 1) * f.limit],
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM discussion_threads t WHERE ${where}`, params),
  ]);
  return {
    data: rows.rows.map((r) => ({ ...r, has_flagged: manager && r.has_flagged })), // only moderators see the flag marker
    pagination: pagination(f.page, f.limit, count.rows[0]!.n),
    can_moderate: manager,
  };
}

export async function createThread(courseId: string, user: AuthUser, input: { title: string; content: string }) {
  const { course } = await requireCourseMember(courseId, user);
  return withTransaction(async (db) => {
    const t = await db.query<{ id: string }>("INSERT INTO discussion_threads (course_id, created_by, title) VALUES ($1, $2, $3) RETURNING id", [courseId, user.id, input.title]);
    const threadId = t.rows[0]!.id;
    await db.query("INSERT INTO discussion_posts (thread_id, user_id, content) VALUES ($1, $2, $3)", [threadId, user.id, input.content]);
    // Tell the instructor about a new question (not when they asked it themselves).
    if (user.id !== course.instructor_id) {
      await notify(db, [course.instructor_id], { type: "discussion", title: `New discussion in "${course.title}"`, body: input.title, link: `/learn/${courseId}?tab=community&thread=${threadId}` });
    }
    return { id: threadId };
  });
}

export async function getThreadDetail(threadId: string, user: AuthUser) {
  const t = await getThread(threadId);
  const { manager } = await requireCourseMember(t.course_id, user);
  const [thread, posts] = await Promise.all([
    pool.query(
      `SELECT t.id, t.title, t.is_pinned, t.created_at, COALESCE(${shortNameSql("u")}, 'Deleted user') AS author_name,
              COALESCE(t.created_by = $2, false) AS by_instructor
       FROM discussion_threads t LEFT JOIN users u ON u.id = t.created_by WHERE t.id = $1`,
      [threadId, t.instructor_id],
    ),
    pool.query(
      `SELECT p.id, p.parent_id, p.content, p.created_at, p.is_flagged,
              COALESCE(${shortNameSql("u")}, 'Deleted user') AS author_name, COALESCE(p.user_id = $2, false) AS by_instructor,
              COALESCE(p.user_id = $3, false) AS mine,
              (SELECT count(*)::int FROM post_reports r WHERE r.post_id = p.id) AS report_count,
              EXISTS (SELECT 1 FROM post_reports r WHERE r.post_id = p.id AND r.reporter_id = $3) AS reported_by_me
       FROM discussion_posts p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.thread_id = $1 ORDER BY p.created_at, p.id LIMIT $4`,
      [threadId, t.instructor_id, user.id, MAX_POSTS_PER_THREAD],
    ),
  ]);
  return {
    thread: { ...thread.rows[0], course_id: t.course_id, course_title: t.course_title },
    posts: posts.rows.map((p) => ({ ...p, is_flagged: manager && p.is_flagged, report_count: manager ? p.report_count : 0 })),
    can_moderate: manager,
  };
}

export async function reply(threadId: string, user: AuthUser, input: { content: string; parent_id?: string }) {
  const t = await getThread(threadId);
  await requireCourseMember(t.course_id, user);
  return withTransaction(async (db) => {
    // Lock the thread row so two simultaneous replies can't both slip past the size limit.
    await db.query("SELECT 1 FROM discussion_threads WHERE id = $1 FOR UPDATE", [threadId]);
    const n = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM discussion_posts WHERE thread_id = $1", [threadId]);
    if (n.rows[0]!.n >= MAX_POSTS_PER_THREAD) throw new AppError(400, "VALIDATION_ERROR", "This discussion is full. Please start a new one.");

    let parentAuthor: string | null = null;
    if (input.parent_id) {
      const parent = await db.query<{ user_id: string | null }>("SELECT user_id FROM discussion_posts WHERE id = $1 AND thread_id = $2", [input.parent_id, threadId]);
      if (!parent.rows[0]) throw new AppError(400, "VALIDATION_ERROR", "The post you're replying to isn't in this discussion.", "parent_id");
      parentAuthor = parent.rows[0].user_id;
    }
    const ins = await db.query(
      "INSERT INTO discussion_posts (thread_id, parent_id, user_id, content) VALUES ($1, $2, $3, $4) RETURNING id, created_at",
      [threadId, input.parent_id ?? null, user.id, input.content],
    );
    await db.query("UPDATE discussion_threads SET last_activity_at = now() WHERE id = $1", [threadId]);

    // Tell the thread's author and the person being replied to (once each, never the replier).
    const who = await db.query<{ name: string }>(`SELECT ${shortNameSql("u")} AS name FROM users u WHERE u.id = $1`, [user.id]);
    const recipients = [...new Set([t.created_by, parentAuthor].filter((id): id is string => !!id && id !== user.id))];
    await notify(db, recipients, {
      type: "discussion", title: `${who.rows[0]?.name ?? "Someone"} replied in "${t.title}"`, body: excerpt(input.content),
      link: `/learn/${t.course_id}?tab=community&thread=${threadId}`,
    });
    return ins.rows[0];
  });
}

export async function setPinned(threadId: string, user: AuthUser, pinned: boolean) {
  const t = await getThread(threadId);
  const { manager } = await requireCourseMember(t.course_id, user);
  if (!manager) throw forbidden("Only the instructor can pin discussions");
  await pool.query("UPDATE discussion_threads SET is_pinned = $2 WHERE id = $1", [threadId, pinned]);
  return { id: threadId, is_pinned: pinned };
}

export async function deleteThread(threadId: string, user: AuthUser) {
  const t = await getThread(threadId);
  const { manager } = await requireCourseMember(t.course_id, user);
  const own = t.created_by === user.id;
  if (!own && !manager) throw forbidden("You can only delete your own discussions");
  await withTransaction(async (db) => {
    await db.query("DELETE FROM discussion_threads WHERE id = $1", [threadId]);
    if (!own) await audit(db, user.id, "post.removed", "thread", threadId, { course_id: t.course_id, title: t.title, author_id: t.created_by, whole_thread: true });
  });
}

// ------------------------------------------------------------------------------------------------ posts
export async function deletePost(postId: string, user: AuthUser) {
  const p = await getPost(postId);
  const { manager } = await requireCourseMember(p.course_id, user);
  const own = p.user_id === user.id;
  if (!own && !manager) throw forbidden("You can only delete your own posts");
  await withTransaction(async (db) => {
    // Deleting the opening post removes the whole discussion; deleting a reply also removes the replies under it.
    if (p.is_opening) await db.query("DELETE FROM discussion_threads WHERE id = $1", [p.thread_id]);
    else await db.query("DELETE FROM discussion_posts WHERE id = $1", [postId]);
    if (!own) await audit(db, user.id, "post.removed", "post", postId, { course_id: p.course_id, thread_title: p.thread_title, author_id: p.user_id, excerpt: excerpt(p.content), whole_thread: p.is_opening });
  });
  return { thread_deleted: p.is_opening };
}

export async function reportPost(postId: string, user: AuthUser, reason?: string) {
  const p = await getPost(postId);
  await requireCourseMember(p.course_id, user);
  if (p.user_id === user.id) throw new AppError(400, "VALIDATION_ERROR", "You can't report your own post. Delete it instead.");
  await withTransaction(async (db) => {
    await db.query("INSERT INTO post_reports (post_id, reporter_id, reason) VALUES ($1, $2, $3) ON CONFLICT (post_id, reporter_id) DO NOTHING", [postId, user.id, reason ?? null]);
    await db.query("UPDATE discussion_posts SET is_flagged = true WHERE id = $1", [postId]);
  });
  return { reported: true };
}

/** Owner or admin: the post is fine, clear its reports. */
export async function dismissReports(postId: string, user: AuthUser) {
  const p = await getPost(postId);
  const { manager } = await requireCourseMember(p.course_id, user);
  if (!manager) throw forbidden("Only the instructor or an admin can review reports");
  await withTransaction(async (db) => {
    await db.query("DELETE FROM post_reports WHERE post_id = $1", [postId]);
    await db.query("UPDATE discussion_posts SET is_flagged = false WHERE id = $1", [postId]);
    await audit(db, user.id, "post.reports_dismissed", "post", postId, { course_id: p.course_id, excerpt: excerpt(p.content) });
  });
  return { id: postId, is_flagged: false };
}

// ------------------------------------------------------------------------------------------------ admin moderation queue
export async function listFlagged(f: { page: number; limit: number }) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT p.id, p.content, p.created_at, p.thread_id, t.title AS thread_title, c.id AS course_id, c.title AS course_title,
              u.full_name AS author_name, u.email AS author_email,
              count(r.id)::int AS report_count,
              COALESCE(array_agg(r.reason ORDER BY r.created_at) FILTER (WHERE r.reason IS NOT NULL), '{}') AS reasons
       FROM discussion_posts p
       JOIN discussion_threads t ON t.id = p.thread_id JOIN courses c ON c.id = t.course_id
       LEFT JOIN users u ON u.id = p.user_id LEFT JOIN post_reports r ON r.post_id = p.id
       WHERE p.is_flagged GROUP BY p.id, t.title, c.id, c.title, u.full_name, u.email
       ORDER BY max(r.created_at) DESC NULLS LAST LIMIT $1 OFFSET $2`,
      [f.limit, (f.page - 1) * f.limit],
    ),
    pool.query<{ n: number }>("SELECT count(*)::int AS n FROM discussion_posts WHERE is_flagged"),
  ]);
  return { data: rows.rows, pagination: pagination(f.page, f.limit, count.rows[0]!.n) };
}
