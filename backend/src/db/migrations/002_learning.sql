-- Week 2: video files, progress, notes, assignments, quizzes, certificates, badges, streaks.

ALTER TABLE lectures
  ADD COLUMN video_path TEXT,          -- file inside UPLOAD_DIR (null = no uploaded video)
  ADD COLUMN video_mime VARCHAR(100);

-- One row per (student's enrollment, lecture).
CREATE TABLE lecture_progress (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id    UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lecture_id       UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  position_seconds INT NOT NULL DEFAULT 0,   -- where to resume
  watched_seconds  INT NOT NULL DEFAULT 0,   -- furthest point reached (analytics)
  completed        BOOLEAN NOT NULL DEFAULT FALSE,
  last_watched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, lecture_id)
);
CREATE INDEX idx_progress_lecture ON lecture_progress(lecture_id);

CREATE TABLE notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lecture_id        UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  timestamp_seconds INT NOT NULL DEFAULT 0,
  content           TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notes_user_lecture ON notes(user_id, lecture_id);

CREATE TABLE bookmarks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lecture_id        UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  timestamp_seconds INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookmarks_user_lecture ON bookmarks(user_id, lecture_id);

CREATE TABLE assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title        VARCHAR(200) NOT NULL,
  instructions TEXT,
  rubric       JSONB,                       -- [{ "criterion": "...", "points": 10 }]
  due_date     TIMESTAMPTZ,
  max_points   INT NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_assignments_course ON assignments(course_id);

CREATE TABLE assignment_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_size     INT NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  grade         NUMERIC(6,2),
  feedback      TEXT,
  graded_at     TIMESTAMPTZ,
  UNIQUE (assignment_id, user_id)           -- one submission per student; resubmitting replaces it
);

CREATE TABLE quizzes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id    UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title        VARCHAR(200) NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,   -- students only see published quizzes
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quizzes_module ON quizzes(module_id);

CREATE TABLE quiz_questions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id          UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text    TEXT NOT NULL,
  question_type    VARCHAR(20) NOT NULL CHECK (question_type IN ('mcq', 'multi_select', 'short_answer')),
  points           INT NOT NULL DEFAULT 1,
  accepted_answers TEXT[],                   -- short answers that count as correct (null = needs manual review)
  order_index      INT NOT NULL
);
CREATE INDEX idx_questions_quiz ON quiz_questions(quiz_id);

CREATE TABLE quiz_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct  BOOLEAN NOT NULL DEFAULT FALSE,
  order_index INT NOT NULL
);
CREATE INDEX idx_options_question ON quiz_options(question_id);

CREATE TABLE quiz_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id      UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score        NUMERIC(5,2),                 -- 0-100, null until submitted (or if nothing was auto-gradable)
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ
);
CREATE INDEX idx_attempts_user_quiz ON quiz_attempts(user_id, quiz_id);

CREATE TABLE quiz_answers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id          UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id         UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  selected_option_ids UUID[],
  text_answer         TEXT,
  is_correct          BOOLEAN,               -- null = not auto-gradable
  points_awarded      NUMERIC(6,2)
);
CREATE INDEX idx_answers_attempt ON quiz_answers(attempt_id);

CREATE TABLE certificates (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  code      VARCHAR(20) UNIQUE NOT NULL,     -- public verification code
  file_path TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);

CREATE TABLE badges (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50) UNIQUE NOT NULL,
  name        VARCHAR(80) NOT NULL,
  description TEXT NOT NULL
);
INSERT INTO badges (code, name, description) VALUES
  ('first_course', 'First course completed', 'Finish every lecture of a course.'),
  ('streak_7',     '7-day streak',           'Learn on 7 days in a row.'),
  ('quiz_perfect', 'Perfect score',          'Score 100% on a quiz.');

CREATE TABLE user_badges (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id  INT  NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE streaks (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak   INT NOT NULL DEFAULT 0,
  longest_streak   INT NOT NULL DEFAULT 0,
  last_active_date DATE
);
