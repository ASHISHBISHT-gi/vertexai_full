import { env } from "../../config/env";
import { pool } from "../../db/pool";
import type { AuthUser } from "../../middleware/auth";
import { cache } from "../../lib/ttlCache";
import { requireCourseMember, shortNameSql } from "../shared/access";

interface Row {
  user_id: string; name: string; quiz_points: number; lectures_completed: number; progress_percent: number; points: number; rank: number;
}

/** How points work: each published quiz counts its BEST score (0-100); every completed lecture adds 10. */
async function compute(courseId: string): Promise<Row[]> {
  const { rows } = await pool.query<Row>(
    `WITH best AS (
       SELECT qa.user_id, qa.quiz_id, MAX(qa.score) AS score
       FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id AND q.is_published JOIN modules m ON m.id = q.module_id
       WHERE m.course_id = $1 AND qa.submitted_at IS NOT NULL AND qa.score IS NOT NULL GROUP BY qa.user_id, qa.quiz_id
     ), quiz AS (SELECT user_id, SUM(score) AS pts FROM best GROUP BY user_id),
     done AS (
       SELECT e.user_id, count(*) FILTER (WHERE lp.completed) AS n
       FROM enrollments e LEFT JOIN lecture_progress lp ON lp.enrollment_id = e.id WHERE e.course_id = $1 GROUP BY e.user_id
     )
     SELECT u.id AS user_id, ${shortNameSql("u")} AS name,
            COALESCE(quiz.pts, 0)::float8 AS quiz_points, COALESCE(done.n, 0)::int AS lectures_completed,
            e.progress_percent::float8 AS progress_percent,
            (COALESCE(quiz.pts, 0) + COALESCE(done.n, 0) * 10)::float8 AS points,
            RANK() OVER (ORDER BY (COALESCE(quiz.pts, 0) + COALESCE(done.n, 0) * 10) DESC, e.progress_percent DESC)::int AS rank
     FROM enrollments e JOIN users u ON u.id = e.user_id AND u.is_active
     LEFT JOIN quiz ON quiz.user_id = e.user_id LEFT JOIN done ON done.user_id = e.user_id
     WHERE e.course_id = $1 ORDER BY rank, u.full_name`,
    [courseId],
  );
  return rows;
}

/**
 * Top 10 plus "you". The ranked list for the whole course is cached (default 60 s, PRD 9.4); who "you" are is
 * worked out per request, so one student's cached result never leaks to another as "mine". Ids are never sent out.
 */
export async function leaderboard(courseId: string, user: AuthUser) {
  await requireCourseMember(courseId, user);
  const all = await cache.remember(`leaderboard:${courseId}`, env.LEADERBOARD_CACHE_SECONDS, () => compute(courseId));
  const strip = ({ user_id, ...rest }: Row) => ({ ...rest, mine: user_id === user.id });
  const top = all.slice(0, 10).map(strip);
  const me = all.find((r) => r.user_id === user.id);
  return {
    top,
    me: me && me.rank > 10 ? strip(me) : null,
    participants: all.length,
    how_points_work: "Each quiz counts your best score (out of 100). Every lecture you finish adds 10 points.",
  };
}
