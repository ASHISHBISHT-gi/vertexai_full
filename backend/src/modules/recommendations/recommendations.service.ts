import { pool } from "../../db/pool";

const RANK: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3 };

interface Enrolled { id: string; title: string; category: string | null; difficulty: string | null; progress: number; mastery: number | null }

/**
 * "What should I take next?" Rule-based signals plus embedding similarity, combined into one score:
 *  - similarity: how close the course's content is to what the student is already studying (pgvector)
 *  - affinity:   do they study this category, and how far did they get?
 *  - fit:        is the difficulty the right next step, judged from quiz mastery and completion?
 *  - popularity: a small tie-breaker
 * It's computed when asked (milliseconds), so there's no nightly job to run.
 */
export async function recommendForUser(userId: string, limit = 5) {
  const enrolled = (
    await pool.query<Enrolled>(
      `SELECT c.id, c.title, c.category, c.difficulty, e.progress_percent::float8 AS progress,
              (SELECT AVG(tm.score)::float8 FROM topic_mastery tm JOIN modules m ON m.id = tm.module_id
                WHERE tm.user_id = $1 AND m.course_id = c.id) AS mastery
       FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1`,
      [userId],
    )
  ).rows;
  const enrolledIds = enrolled.map((e) => e.id);

  // The "centre of gravity" of everything the student is studying: the average of all their courses' passage vectors.
  let centroid: string | null = null;
  if (enrolledIds.length) {
    const c = await pool.query<{ centroid: string | null }>("SELECT AVG(embedding)::text AS centroid FROM document_chunks WHERE course_id = ANY($1::uuid[])", [enrolledIds]);
    centroid = c.rows[0]?.centroid ?? null;
  }

  const candidates = (
    await pool.query(
      `SELECT c.id, c.title, c.description, c.category, c.difficulty, c.price::float8 AS price, c.thumbnail_url,
              u.full_name AS instructor_name,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS enrollment_count,
              CASE WHEN $2::vector IS NULL THEN NULL
                   ELSE (SELECT 1 - (AVG(dc.embedding) <=> $2::vector) FROM document_chunks dc WHERE dc.course_id = c.id) END AS similarity
       FROM courses c JOIN users u ON u.id = c.instructor_id
       WHERE c.status = 'approved' AND c.id <> ALL($1::uuid[])`,
      [enrolledIds, centroid],
    )
  ).rows as Array<{ id: string; title: string; description: string | null; category: string | null; difficulty: string | null; price: number; thumbnail_url: string | null; instructor_name: string; enrollment_count: number; similarity: number | null }>;

  // Per category: how much have they engaged, and what level have they proven?
  const affinity: Record<string, number> = {};
  const level: Record<string, number> = {};
  for (const e of enrolled) {
    if (!e.category) continue;
    affinity[e.category] = (affinity[e.category] ?? 0) + 0.5 + 0.5 * (e.progress / 100);
    const rank = RANK[e.difficulty ?? ""] ?? 1;
    const proven = e.progress >= 100 || (e.mastery ?? 0) >= 70 ? rank : rank - 1; // finished or aced it => that level is done
    level[e.category] = Math.max(level[e.category] ?? 0, proven);
  }
  const maxAffinity = Math.max(1, ...Object.values(affinity));
  const maxEnrolled = Math.max(1, ...candidates.map((c) => c.enrollment_count));
  const haveSimilarity = candidates.some((c) => c.similarity !== null);

  const scored = candidates.map((c) => {
    const aff = c.category ? (affinity[c.category] ?? 0) / maxAffinity : 0;
    const known = c.category !== null && level[c.category] !== undefined;
    const rank = RANK[c.difficulty ?? ""] ?? 1;
    const gap = rank - (known ? level[c.category!]! : 0);
    const fit = !known ? 0.5 : gap === 1 ? 1 : gap === 0 ? 0.7 : gap < 0 ? 0.3 : 0.2;
    const sim = Math.min(1, Math.max(0, c.similarity ?? 0));
    const pop = c.enrollment_count / maxEnrolled;
    const score = haveSimilarity ? 0.4 * sim + 0.3 * aff + 0.2 * fit + 0.1 * pop : 0.5 * aff + 0.3 * fit + 0.2 * pop;

    let reason = "Popular with other students.";
    if (known && gap === 1 && aff > 0) reason = `You're making good progress in ${c.category}. This ${c.difficulty} course is the natural next step.`;
    else if (aff > 0 && c.category) reason = `More ${c.category}, which you've been studying.`;
    else if (haveSimilarity && sim >= 0.5) reason = "Covers topics similar to the courses you're taking.";
    return { ...c, enrollment_count: undefined, similarity: undefined, score: Math.round(score * 1000) / 1000, reason };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
