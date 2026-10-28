import { pool, type Db } from "../../db/pool";
import { notFound } from "../../utils/errors";
import { enqueueEmails } from "../email/outbox";

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Also email it (to people who haven't opted out). Use for things worth interrupting someone for. */
  email?: boolean;
}

/**
 * Creates an in-app notification for each user, and (with `email: true`) queues an email too.
 * Every part of the app that wants to tell someone something calls this one function.
 */
export async function notify(db: Db, userIds: string[], n: NotificationInput) {
  if (userIds.length === 0) return;
  await db.query(
    "INSERT INTO notifications (user_id, type, title, body, link) SELECT unnest($1::uuid[]), $2, $3, $4, $5",
    [userIds, n.type, n.title.slice(0, 150), n.body ?? null, n.link ?? null],
  );
  if (n.email) await enqueueEmails(db, userIds, n.title, n.body ?? n.title, n.link);
}

export async function getPreferences(userId: string) {
  const { rows } = await pool.query<{ email_notifications: boolean }>("SELECT email_notifications FROM users WHERE id = $1", [userId]);
  if (!rows[0]) throw notFound("User");
  return rows[0];
}

export async function setPreferences(userId: string, input: { email_notifications: boolean }) {
  const { rows } = await pool.query("UPDATE users SET email_notifications = $2 WHERE id = $1 RETURNING email_notifications", [userId, input.email_notifications]);
  if (!rows[0]) throw notFound("User");
  return rows[0];
}

export async function listNotifications(userId: string, opts: { unreadOnly: boolean; page: number; limit: number }) {
  const where = "user_id = $1" + (opts.unreadOnly ? " AND NOT is_read" : "");
  const [rows, total, unread] = await Promise.all([
    pool.query(
      `SELECT id, type, title, body, link, is_read, created_at FROM notifications WHERE ${where}
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, opts.limit, (opts.page - 1) * opts.limit],
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE ${where}`, [userId]),
    unreadCount(userId),
  ]);
  const count = total.rows[0]!.n;
  return { data: rows.rows, unread, pagination: { page: opts.page, limit: opts.limit, total: count, totalPages: Math.max(1, Math.ceil(count / opts.limit)) } };
}

export async function unreadCount(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read", [userId]);
  return rows[0]!.n;
}

export async function markRead(id: string, userId: string) {
  // user_id in the WHERE: you can only ever touch your own notifications.
  const { rows } = await pool.query("UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id, is_read", [id, userId]);
  if (!rows[0]) throw notFound("Notification");
  return rows[0];
}

export async function markAllRead(userId: string) {
  const { rowCount } = await pool.query("UPDATE notifications SET is_read = true WHERE user_id = $1 AND NOT is_read", [userId]);
  return { updated: rowCount ?? 0 };
}
