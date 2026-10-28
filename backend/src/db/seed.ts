import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { pool } from "./pool";
import { DEMO_TRANSCRIPTS } from "./seed.transcripts";

if (env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const PASSWORD = "Password123!";

const DEMO_USERS = [
  { full_name: "Meera Admin", email: "admin@lms.dev", role: "admin" },
  { full_name: "Rohit Instructor", email: "instructor@lms.dev", role: "instructor" },
  { full_name: "Ananya Student", email: "student@lms.dev", role: "student" },
] as const;

const DEMO_COURSES = [
  {
    title: "Data Structures & Algorithms in JavaScript",
    description: "Arrays, linked lists, trees, graphs, sorting and searching, with plenty of practice problems.",
    category: "Programming", difficulty: "intermediate", price: 0,
    modules: [
      { title: "Sorting Algorithms", lectures: ["Bubble and Selection Sort", "Merge Sort", "Quicksort and its worst case"] },
      { title: "Trees", lectures: ["Binary Trees", "Binary Search Trees"] },
    ],
  },
  {
    title: "SQL for Beginners",
    description: "Write real queries against PostgreSQL: SELECT, JOINs, GROUP BY, subqueries and CTEs.",
    category: "Databases", difficulty: "beginner", price: 0,
    modules: [
      { title: "Querying Basics", lectures: ["SELECT and WHERE", "Sorting and limiting"] },
      { title: "Joins", lectures: ["INNER JOIN", "LEFT JOIN"] },
    ],
  },
  {
    title: "Intro to Machine Learning",
    description: "Supervised learning from first principles: regression, classification and evaluation.",
    category: "AI", difficulty: "advanced", price: 499,
    modules: [{ title: "Regression", lectures: ["Linear Regression", "Gradient Descent"] }],
  },
] as const;

/** A sample assignment and quiz so the demo course has the full learning loop. */
async function seedSqlExtras(courseId: string, moduleId: string) {
  await pool.query(
    `INSERT INTO assignments (course_id, title, instructions, rubric, due_date, max_points) VALUES ($1, $2, $3, $4, now() + interval '30 days', 50)`,
    [
      courseId,
      "Write five queries",
      "Using the sample `employees` table, write five SELECT queries (filtering, sorting, one JOIN). Submit them as a single .sql or .pdf file.",
      JSON.stringify([{ criterion: "Queries run without errors", points: 25 }, { criterion: "Correct results", points: 15 }, { criterion: "Readable formatting", points: 10 }]),
    ],
  );
  const quiz = await pool.query<{ id: string }>(
    "INSERT INTO quizzes (module_id, title, is_published) VALUES ($1, 'Querying basics check', true) RETURNING id",
    [moduleId],
  );
  const questions = [
    { text: "Which clause filters rows before they are grouped?", type: "mcq", accepted: null, options: [["WHERE", true], ["HAVING", false], ["ORDER BY", false], ["LIMIT", false]] },
    { text: "Which of these are aggregate functions?", type: "multi_select", accepted: null, options: [["COUNT", true], ["SUM", true], ["UPPER", false], ["MAX", true]] },
    { text: "Which keyword removes duplicate rows from a SELECT result?", type: "short_answer", accepted: ["distinct"], options: [] },
  ] as const;
  for (const [i, q] of questions.entries()) {
    const question = await pool.query<{ id: string }>(
      "INSERT INTO quiz_questions (quiz_id, question_text, question_type, points, accepted_answers, order_index) VALUES ($1, $2, $3, 1, $4, $5) RETURNING id",
      [quiz.rows[0]!.id, q.text, q.type, q.accepted, i],
    );
    for (const [j, [text, correct]] of q.options.entries()) {
      await pool.query("INSERT INTO quiz_options (question_id, option_text, is_correct, order_index) VALUES ($1, $2, $3, $4)", [question.rows[0]!.id, text, correct, j]);
    }
  }
}

/** A few extra students with enrolments, progress and reviews, spread over recent days, so dashboards and ratings have something to show. */
const CROWD = [
  { name: "Priya Nair", email: "priya@lms.dev", joined: 13, activeToday: true, enrol: [
    ["SQL for Beginners", 12, 100, 5, "Clear and practical. The JOIN lectures finally made sense."],
    ["Data Structures & Algorithms in JavaScript", 6, 45, 4, "Good pace. I'd love more practice problems."]] },
  { name: "Karan Mehta", email: "karan@lms.dev", joined: 9, activeToday: false, enrol: [
    ["SQL for Beginners", 8, 60, 4, "Solid introduction."],
    ["Intro to Machine Learning", 3, 10, null, null]] },
  { name: "Sneha Rao", email: "sneha@lms.dev", joined: 5, activeToday: true, enrol: [
    ["Data Structures & Algorithms in JavaScript", 4, 80, 5, "Best explanation of quicksort I've seen."]] },
  { name: "Arjun Das", email: "arjun@lms.dev", joined: 2, activeToday: false, enrol: [
    ["SQL for Beginners", 1, 25, 3, "Fine, but I wanted more exercises."]] },
] as const;

async function seedCrowd(passwordHash: string) {
  if ((await pool.query("SELECT 1 FROM users WHERE email = 'priya@lms.dev'")).rowCount) return false;
  for (const p of CROWD) {
    const user = await pool.query<{ id: string }>(
      "INSERT INTO users (full_name, email, password_hash, created_at) VALUES ($1, $2, $3, now() - make_interval(days => $4::int)) RETURNING id",
      [p.name, p.email, passwordHash, p.joined],
    );
    const id = user.rows[0]!.id;
    await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'student'", [id]);
    for (const [title, daysAgo, progress, rating, comment] of p.enrol) {
      const course = await pool.query<{ id: string }>("SELECT id FROM courses WHERE title = $1 AND status = 'approved'", [title]);
      if (!course.rows[0]) continue;
      await pool.query(
        "INSERT INTO enrollments (user_id, course_id, enrolled_at, progress_percent) VALUES ($1, $2, now() - make_interval(days => $3::int), $4) ON CONFLICT DO NOTHING",
        [id, course.rows[0].id, daysAgo, progress],
      );
      if (rating !== null) {
        await pool.query("INSERT INTO course_reviews (course_id, user_id, rating, comment) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [course.rows[0].id, id, rating, comment]);
      }
    }
    await pool.query(
      `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date)
       VALUES ($1, 3, 3, (now() AT TIME ZONE $2::text)::date - $3::int)`,
      [id, env.APP_TIMEZONE, p.activeToday ? 0 : 3],
    );
  }
  return true;
}

/** Week 4b demo content: one discussion and one announcement in "SQL for Beginners" (only if it has none yet). */
async function seedCommunity(instructorId: string) {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT c.id FROM courses c WHERE c.title = 'SQL for Beginners' AND c.instructor_id = $1
       AND NOT EXISTS (SELECT 1 FROM discussion_threads t WHERE t.course_id = c.id) LIMIT 1`,
    [instructorId],
  );
  const courseId = rows[0]?.id;
  if (!courseId) return false;
  const people = await pool.query<{ id: string; email: string }>(
    "SELECT id, email FROM users WHERE email IN ('student@lms.dev', 'priya@lms.dev', 'karan@lms.dev')",
  );
  const byEmail = Object.fromEntries(people.rows.map((r) => [r.email, r.id]));
  const asker = byEmail["student@lms.dev"];
  if (!asker) return false;
  const t = await pool.query<{ id: string }>(
    "INSERT INTO discussion_threads (course_id, created_by, title, is_pinned) VALUES ($1, $2, 'What is the difference between WHERE and HAVING?', false) RETURNING id",
    [courseId, asker],
  );
  const threadId = t.rows[0]!.id;
  const first = await pool.query<{ id: string }>(
    "INSERT INTO discussion_posts (thread_id, user_id, content, created_at) VALUES ($1, $2, $3, now() - interval '3 hours') RETURNING id",
    [threadId, asker, "I keep getting an error when I use WHERE with COUNT(*). When do I use HAVING instead?"],
  );
  const answer = await pool.query<{ id: string }>(
    "INSERT INTO discussion_posts (thread_id, parent_id, user_id, content, created_at) VALUES ($1, $2, $3, $4, now() - interval '2 hours') RETURNING id",
    [threadId, first.rows[0]!.id, instructorId, "WHERE filters rows before they are grouped. HAVING filters the groups after GROUP BY, so it's the one that can use COUNT(*) or SUM(...)."],
  );
  if (byEmail["priya@lms.dev"]) {
    await pool.query(
      "INSERT INTO discussion_posts (thread_id, parent_id, user_id, content, created_at) VALUES ($1, $2, $3, $4, now() - interval '1 hour')",
      [threadId, answer.rows[0]!.id, byEmail["priya@lms.dev"], "That cleared it up for me too, thanks!"],
    );
  }
  await pool.query("UPDATE discussion_threads SET last_activity_at = now() - interval '1 hour' WHERE id = $1", [threadId]);
  await pool.query(
    "INSERT INTO announcements (course_id, posted_by, title, content) VALUES ($1, $2, 'Welcome to SQL for Beginners', 'Ask questions in the Community tab. I read every thread. Quizzes unlock your leaderboard points, so give them a go after each module.')",
    [courseId, instructorId],
  );
  return true;
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const ids: Record<string, string> = {};

  for (const u of DEMO_USERS) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [u.full_name, u.email, passwordHash],
    );
    ids[u.role] = rows[0]!.id;
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2
       ON CONFLICT DO NOTHING`,
      [ids[u.role], u.role],
    );
  }

  const existing = await pool.query("SELECT 1 FROM courses WHERE instructor_id = $1 LIMIT 1", [ids.instructor]);
  if (existing.rowCount === 0) {
    for (const c of DEMO_COURSES) {
      const course = await pool.query<{ id: string }>(
        `INSERT INTO courses (instructor_id, title, description, category, difficulty, price, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'approved') RETURNING id`,
        [ids.instructor, c.title, c.description, c.category, c.difficulty, c.price],
      );
      for (const [mi, m] of c.modules.entries()) {
        const mod = await pool.query<{ id: string }>(
          "INSERT INTO modules (course_id, title, order_index) VALUES ($1, $2, $3) RETURNING id",
          [course.rows[0]!.id, m.title, mi],
        );
        for (const [li, title] of m.lectures.entries()) {
          await pool.query(
            "INSERT INTO lectures (module_id, title, duration_seconds, order_index) VALUES ($1, $2, $3, $4)",
            [mod.rows[0]!.id, title, 600 + li * 120, li],
          );
        }
      }
    }
    console.log(`Created ${DEMO_COURSES.length} approved demo courses.`);
  } else {
    console.log("Demo courses already exist, skipping.");
  }

  if (await seedCrowd(passwordHash)) console.log("Added 4 extra demo students (priya@, karan@, sneha@, arjun@lms.dev) with enrolments and reviews.");

  // Week 2 extras. Runs on existing databases too, so re-running `pnpm seed` after upgrading is enough.
  const sql = await pool.query<{ id: string; module_id: string }>(
    `SELECT c.id, (SELECT m.id FROM modules m WHERE m.course_id = c.id ORDER BY m.order_index LIMIT 1) AS module_id
     FROM courses c WHERE c.title = 'SQL for Beginners' AND c.instructor_id = $1
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.course_id = c.id) LIMIT 1`,
    [ids.instructor],
  );
  if (sql.rows[0]?.module_id) {
    await seedSqlExtras(sql.rows[0].id, sql.rows[0].module_id);
    console.log("Added a sample assignment and quiz to 'SQL for Beginners'.");
  }

  if (await seedCommunity(ids.instructor)) console.log("Added a sample discussion and announcement to 'SQL for Beginners'.");

  // Transcripts for the AI tutor (only fills lectures that don't have one yet).
  let filled = 0;
  for (const [course, lectures] of Object.entries(DEMO_TRANSCRIPTS)) {
    for (const [lecture, vtt] of Object.entries(lectures)) {
      const r = await pool.query(
        `UPDATE lectures SET transcript = $3, transcript_updated_at = now()
         WHERE title = $2 AND (transcript IS NULL OR transcript = '')
           AND module_id IN (SELECT m.id FROM modules m JOIN courses c ON c.id = m.course_id WHERE c.title = $1)`,
        [course, lecture, vtt],
      );
      filled += r.rowCount ?? 0;
    }
  }
  if (filled) console.log(`Added demo transcripts to ${filled} lectures (run the AI service's index command to make them searchable).`);

  console.log("\nDemo logins (password for all: " + PASSWORD + ")");
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(10)} ${u.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
