import { pool, withTransaction, type Db } from "../../db/pool";
import type { AuthUser } from "../../middleware/auth";
import { conflict, forbidden, notFound, AppError } from "../../utils/errors";
import { awardBadge, touchStreak } from "../gamification/gamification.service";
import { assertCanManage, canManage, getEnrollment } from "../shared/access";

export type QuestionType = "mcq" | "multi_select" | "short_answer";
export interface NewQuestion {
  question_text: string; question_type: QuestionType; points?: number;
  options?: { option_text: string; is_correct: boolean }[]; accepted_answers?: string[];
}
interface Question {
  id: string; question_text: string; question_type: QuestionType; points: number;
  accepted_answers: string[] | null; order_index: number;
  options: { id: string; option_text: string; is_correct: boolean }[];
}
interface FullQuiz { id: string; title: string; is_published: boolean; is_ai_generated: boolean; module_id: string; course_id: string; instructor_id: string; questions: Question[] }

async function loadQuiz(db: Db, quizId: string): Promise<FullQuiz> {
  const q = await db.query(
    `SELECT z.id, z.title, z.is_published, z.is_ai_generated, z.module_id, m.course_id, c.instructor_id
     FROM quizzes z JOIN modules m ON m.id = z.module_id JOIN courses c ON c.id = m.course_id WHERE z.id = $1`,
    [quizId],
  );
  if (!q.rows[0]) throw notFound("Quiz");
  const qs = await db.query(
    "SELECT id, question_text, question_type, points, accepted_answers, order_index FROM quiz_questions WHERE quiz_id = $1 ORDER BY order_index",
    [quizId],
  );
  const ids = qs.rows.map((r) => r.id);
  const os = ids.length
    ? await db.query("SELECT id, question_id, option_text, is_correct FROM quiz_options WHERE question_id = ANY($1::uuid[]) ORDER BY order_index", [ids])
    : { rows: [] as any[] };
  return {
    ...q.rows[0],
    questions: qs.rows.map((r) => ({ ...r, options: os.rows.filter((o) => o.question_id === r.id).map(({ question_id, ...o }) => o) })),
  };
}

/** What a student is allowed to see: no is_correct flags and no accepted answers. */
function studentView(quiz: FullQuiz) {
  return {
    id: quiz.id, title: quiz.title, course_id: quiz.course_id,
    questions: quiz.questions.map((q) => ({
      id: q.id, question_text: q.question_text, question_type: q.question_type, points: q.points,
      options: q.options.map((o) => ({ id: o.id, option_text: o.option_text })),
    })),
  };
}

function ownerView(quiz: FullQuiz) {
  return {
    id: quiz.id, title: quiz.title, is_published: quiz.is_published, is_ai_generated: quiz.is_ai_generated, course_id: quiz.course_id, module_id: quiz.module_id,
    questions: quiz.questions.map(({ order_index, ...q }) => q),
  };
}

export async function createQuiz(user: AuthUser, input: { module_id: string; title: string; questions: NewQuestion[]; is_ai_generated?: boolean; generated_from_lecture_id?: string }) {
  const mod = await pool.query("SELECT c.instructor_id FROM modules m JOIN courses c ON c.id = m.course_id WHERE m.id = $1", [input.module_id]);
  if (!mod.rows[0]) throw notFound("Module");
  assertCanManage(mod.rows[0].instructor_id, user);

  return withTransaction(async (db) => {
    const quiz = await db.query(
      "INSERT INTO quizzes (module_id, title, is_ai_generated, generated_from_lecture_id) VALUES ($1, $2, $3, $4) RETURNING id, title, is_published, is_ai_generated",
      [input.module_id, input.title, input.is_ai_generated ?? false, input.generated_from_lecture_id ?? null],
    );
    for (const [i, q] of input.questions.entries()) {
      const question = await db.query(
        `INSERT INTO quiz_questions (quiz_id, question_text, question_type, points, accepted_answers, order_index)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [quiz.rows[0].id, q.question_text, q.question_type, q.points ?? 1, q.accepted_answers?.length ? q.accepted_answers : null, i],
      );
      for (const [j, o] of (q.options ?? []).entries()) {
        await db.query("INSERT INTO quiz_options (question_id, option_text, is_correct, order_index) VALUES ($1, $2, $3, $4)", [question.rows[0].id, o.option_text, o.is_correct, j]);
      }
    }
    return { ...quiz.rows[0], question_count: input.questions.length };
  });
}

export async function updateQuiz(quizId: string, user: AuthUser, input: { title?: string; is_published?: boolean }) {
  const quiz = await loadQuiz(pool, quizId);
  assertCanManage(quiz.instructor_id, user);
  if (input.is_published && quiz.questions.length === 0) throw new AppError(400, "VALIDATION_ERROR", "Add at least one question before publishing", "is_published");
  const { rows } = await pool.query(
    "UPDATE quizzes SET title = COALESCE($2, title), is_published = COALESCE($3, is_published) WHERE id = $1 RETURNING id, title, is_published",
    [quizId, input.title ?? null, input.is_published ?? null],
  );
  return rows[0];
}

export async function deleteQuiz(quizId: string, user: AuthUser) {
  const quiz = await loadQuiz(pool, quizId);
  assertCanManage(quiz.instructor_id, user);
  await pool.query("DELETE FROM quizzes WHERE id = $1", [quizId]);
}

export async function getQuiz(quizId: string, user: AuthUser) {
  const quiz = await loadQuiz(pool, quizId);
  if (canManage(user, quiz.instructor_id)) return ownerView(quiz);
  if (!quiz.is_published) throw notFound("Quiz");
  if (!(await getEnrollment(pool, user.id, quiz.course_id))) throw forbidden("Enroll in this course first");
  return studentView(quiz);
}

export async function listCourseQuizzes(courseId: string, user: AuthUser) {
  const course = await pool.query("SELECT instructor_id FROM courses WHERE id = $1", [courseId]);
  if (!course.rows[0]) throw notFound("Course");
  const owner = canManage(user, course.rows[0].instructor_id);
  if (!owner && !(await getEnrollment(pool, user.id, courseId))) throw forbidden("Enroll in this course first");

  const { rows } = await pool.query(
    `SELECT z.id, z.title, z.is_published, z.is_ai_generated, m.id AS module_id, m.title AS module_title,
            (SELECT count(*)::int FROM quiz_questions q WHERE q.quiz_id = z.id) AS question_count,
            (SELECT count(*)::int FROM quiz_attempts a WHERE a.quiz_id = z.id AND a.submitted_at IS NOT NULL ${owner ? "" : "AND a.user_id = $2"}) AS attempts,
            ${owner ? "NULL::float8" : "(SELECT MAX(a.score)::float8 FROM quiz_attempts a WHERE a.quiz_id = z.id AND a.user_id = $2 AND a.submitted_at IS NOT NULL)"} AS best_score
     FROM quizzes z JOIN modules m ON m.id = z.module_id
     WHERE m.course_id = $1 ${owner ? "" : "AND z.is_published"}
     ORDER BY m.order_index, z.created_at`,
    owner ? [courseId] : [courseId, user.id],
  );
  return rows;
}

export async function startAttempt(quizId: string, user: AuthUser) {
  const quiz = await loadQuiz(pool, quizId);
  if (!quiz.is_published) throw notFound("Quiz");
  if (!(await getEnrollment(pool, user.id, quiz.course_id))) throw forbidden("Enroll in this course first");
  const { rows } = await pool.query("INSERT INTO quiz_attempts (quiz_id, user_id) VALUES ($1, $2) RETURNING id, started_at", [quizId, user.id]);
  return { attempt_id: rows[0].id as string, started_at: rows[0].started_at };
}

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export interface SubmittedAnswer { question_id: string; selected_option_ids?: string[]; text_answer?: string }

/**
 * Grading happens HERE, on the server. The browser only sends what the student picked;
 * it never receives the answer key until after submitting, so it can't be cheated from the client.
 */
export async function submitAttempt(attemptId: string, user: AuthUser, answers: SubmittedAnswer[]) {
  return withTransaction(async (db) => {
    const attempt = await db.query("SELECT id, quiz_id, submitted_at FROM quiz_attempts WHERE id = $1 AND user_id = $2 FOR UPDATE", [attemptId, user.id]);
    if (!attempt.rows[0]) throw notFound("Attempt");
    if (attempt.rows[0].submitted_at) throw conflict("This attempt was already submitted");
    const quiz = await loadQuiz(db, attempt.rows[0].quiz_id);

    let earned = 0, possible = 0, ungraded = 0;
    const results = [];
    for (const q of quiz.questions) {
      const given = answers.find((a) => a.question_id === q.id);
      const validIds = new Set(q.options.map((o) => o.id));
      const selected = (given?.selected_option_ids ?? []).filter((id) => validIds.has(id)); // ignore ids that aren't this question's options
      const correctIds = q.options.filter((o) => o.is_correct).map((o) => o.id);

      let correct: boolean | null;
      if (q.question_type === "mcq") correct = selected.length === 1 && correctIds.includes(selected[0]!);
      else if (q.question_type === "multi_select") correct = sameSet(selected, correctIds); // all-or-nothing
      else if (q.accepted_answers?.length) correct = !!given?.text_answer && q.accepted_answers.map(normalise).includes(normalise(given.text_answer));
      else correct = null; // short answer with no answer key: stored for the instructor, not scored

      if (correct === null) ungraded++;
      else { possible += q.points; if (correct) earned += q.points; }

      await db.query(
        "INSERT INTO quiz_answers (attempt_id, question_id, selected_option_ids, text_answer, is_correct, points_awarded) VALUES ($1, $2, $3::uuid[], $4, $5, $6)",
        [attemptId, q.id, selected, given?.text_answer?.slice(0, 2000) ?? null, correct, correct === null ? null : correct ? q.points : 0],
      );
      results.push({
        question_id: q.id, correct, selected_option_ids: selected, text_answer: given?.text_answer ?? null,
        correct_option_ids: q.question_type === "short_answer" ? [] : correctIds, accepted_answers: q.accepted_answers ?? [],
      });
    }

    const score = possible > 0 ? Math.round((earned / possible) * 10000) / 100 : null;
    await db.query("UPDATE quiz_attempts SET score = $2, submitted_at = now() WHERE id = $1", [attemptId, score]);

    // Mastery of this topic (module): a moving average, so recent attempts matter most (40% new, 60% history).
    // The first attempt simply sets it. The AI tutor and study plan read this to know what the student struggles with.
    if (score !== null) {
      await db.query(
        `INSERT INTO topic_mastery (user_id, module_id, score) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, module_id) DO UPDATE SET
           score = ROUND((topic_mastery.score * 0.6 + EXCLUDED.score * 0.4)::numeric, 2),
           evidence_count = topic_mastery.evidence_count + 1, updated_at = now()`,
        [user.id, quiz.module_id, score],
      );
    }

    const newBadges: string[] = [];
    const streak = await touchStreak(db, user.id);
    if (streak.newBadge) newBadges.push(streak.newBadge);
    if (score === 100) { const b = await awardBadge(db, user.id, "quiz_perfect"); if (b) newBadges.push(b); }

    return { attempt_id: attemptId, score, earned, possible, ungraded_count: ungraded, results, new_badges: newBadges };
  });
}
