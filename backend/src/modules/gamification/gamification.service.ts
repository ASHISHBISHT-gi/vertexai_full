import { env } from "../../config/env";
import { pool, type Db } from "../../db/pool";

/** Gives a badge once. Returns the badge's name if it was newly earned, otherwise null. */
export async function awardBadge(db: Db, userId: string, code: string): Promise<string | null> {
  const { rows } = await db.query<{ name: string }>(
    `WITH b AS (SELECT id, name FROM badges WHERE code = $2),
          ins AS (INSERT INTO user_badges (user_id, badge_id) SELECT $1, id FROM b
                  ON CONFLICT DO NOTHING RETURNING badge_id)
     SELECT b.name FROM b JOIN ins ON ins.badge_id = b.id`,
    [userId, code],
  );
  return rows[0]?.name ?? null;
}

/**
 * Call whenever the student does something that counts as learning.
 * Same day -> unchanged. Consecutive day -> +1. A gap -> back to 1.
 * "Day" is the calendar day in APP_TIMEZONE (so an evening in India isn't "tomorrow" in UTC).
 * Because the streak is recalculated on every activity, no nightly cron job is needed.
 */
export async function touchStreak(db: Db, userId: string): Promise<{ current: number; newBadge: string | null }> {
  const next = `CASE WHEN streaks.last_active_date = EXCLUDED.last_active_date THEN streaks.current_streak
                     WHEN streaks.last_active_date = EXCLUDED.last_active_date - 1 THEN streaks.current_streak + 1
                     ELSE 1 END`;
  const { rows } = await db.query<{ current_streak: number }>(
    `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date)
     VALUES ($1, 1, 1, (now() AT TIME ZONE $2::text)::date)
     ON CONFLICT (user_id) DO UPDATE SET
       current_streak = ${next},
       longest_streak = GREATEST(streaks.longest_streak, ${next}),
       last_active_date = EXCLUDED.last_active_date
     RETURNING current_streak`,
    [userId, env.APP_TIMEZONE],
  );
  const current = rows[0]!.current_streak;
  const newBadge = current >= 7 ? await awardBadge(db, userId, "streak_7") : null;
  return { current, newBadge };
}

export async function getStreak(userId: string) {
  const { rows } = await pool.query(
    `SELECT CASE WHEN last_active_date >= today - 1 THEN current_streak ELSE 0 END AS current_streak,
            longest_streak,
            to_char(last_active_date, 'YYYY-MM-DD') AS last_active_date,
            (last_active_date = today) AS active_today
     FROM streaks, LATERAL (SELECT (now() AT TIME ZONE $2::text)::date AS today) t
     WHERE user_id = $1`,
    [userId, env.APP_TIMEZONE],
  );
  return rows[0] ?? { current_streak: 0, longest_streak: 0, last_active_date: null, active_today: false };
}

/** Every badge, with earned_at filled in for the ones this user has. */
export async function getBadges(userId: string) {
  const { rows } = await pool.query(
    `SELECT b.code, b.name, b.description, ub.earned_at
     FROM badges b LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = $1
     ORDER BY b.id`,
    [userId],
  );
  return rows;
}
