-- Week 3: the AI tutor. Needs the pgvector extension (the pgvector/pgvector Docker image has it).
CREATE EXTENSION IF NOT EXISTS vector;

-- Transcript bookkeeping. lectures.transcript already exists (Week 1); these say whether the AI has read it.
ALTER TABLE lectures
  ADD COLUMN transcript_updated_at TIMESTAMPTZ,
  ADD COLUMN indexed_at            TIMESTAMPTZ,
  ADD COLUMN indexed_chunks        INT NOT NULL DEFAULT 0;

-- The knowledge base: every lecture transcript, cut into passages, each with its embedding.
-- 1024 dimensions = Voyage's default size (and OpenAI's text-embedding-3 can be asked for 1024 too).
CREATE TABLE document_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lecture_id    UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  chunk_text    TEXT NOT NULL,
  start_seconds INT,                       -- where in the video this passage starts (null if the transcript had no timestamps)
  embedding     vector(1024) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chunks_lecture ON document_chunks(lecture_id);
CREATE INDEX idx_chunks_course  ON document_chunks(course_id);
-- HNSW = fast approximate nearest-neighbour search. (The PRD suggests ivfflat, which must be built AFTER the
-- table has data and tuned; HNSW works well from the first row.)
CREATE INDEX idx_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE ai_chat_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  mode       VARCHAR(20) NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'beginner', 'intermediate', 'advanced')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_sessions_user_course ON ai_chat_sessions(user_id, course_id, updated_at DESC);

CREATE TABLE ai_chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  sender     VARCHAR(10) NOT NULL CHECK (sender IN ('user', 'ai')),
  content    TEXT NOT NULL,
  sources    JSONB,                         -- [{lecture_id, lecture_title, timestamp_seconds}] for AI replies
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_session ON ai_chat_messages(session_id, created_at);

-- Per-topic mastery. A "topic" is a module. Updated from quiz results (see quizzes.service.ts).
CREATE TABLE topic_mastery (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id      UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  score          NUMERIC(5,2) NOT NULL,     -- 0-100, recent results weigh more
  evidence_count INT NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module_id)
);

-- Generated summaries are cached: same lecture + level + transcript = same answer, no second AI call.
CREATE TABLE ai_summaries (
  lecture_id      UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  level           VARCHAR(20) NOT NULL,
  transcript_hash CHAR(64) NOT NULL,
  summary         TEXT NOT NULL,
  key_points      JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lecture_id, level)
);

CREATE TABLE flashcards (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id  UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_flashcards_module ON flashcards(module_id);

CREATE TABLE study_plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  plan_json    JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_study_plans_user_course ON study_plans(user_id, course_id, generated_at DESC);

-- Quizzes drafted by the AI are flagged so instructors know to review them.
ALTER TABLE quizzes
  ADD COLUMN is_ai_generated          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN generated_from_lecture_id UUID REFERENCES lectures(id) ON DELETE SET NULL;
