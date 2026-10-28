-- Week 1 schema: auth, courses, enrollment. (Quizzes, AI tables etc. come in later weeks.)

CREATE TABLE roles (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(30) UNIQUE NOT NULL
);
INSERT INTO roles (name) VALUES ('student'), ('instructor'), ('admin');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     VARCHAR(150) NOT NULL,
  email         VARCHAR(180) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INT  NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Refresh tokens are random strings; we only store their SHA-256 hash.
CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE courses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES users(id),
  title         VARCHAR(200) NOT NULL,
  description   TEXT,
  category      VARCHAR(80),
  difficulty    VARCHAR(20) CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  thumbnail_url TEXT,
  price         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_courses_instructor ON courses(instructor_id);
CREATE INDEX idx_courses_pending ON courses(created_at) WHERE status = 'pending';
CREATE INDEX idx_courses_approved ON courses(category, difficulty) WHERE status = 'approved';

CREATE TABLE modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  order_index INT NOT NULL
);
CREATE INDEX idx_modules_course ON modules(course_id);

CREATE TABLE lectures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id        UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title            VARCHAR(200) NOT NULL,
  video_url        TEXT,
  transcript       TEXT,
  duration_seconds INT,
  order_index      INT NOT NULL,
  resource_urls    TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_lectures_module ON lectures(module_id);

CREATE TABLE enrollments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  course_id        UUID NOT NULL REFERENCES courses(id),
  enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  UNIQUE (user_id, course_id)
);
CREATE INDEX idx_enrollments_course ON enrollments(course_id);

CREATE TABLE course_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  reviewed_by UUID NOT NULL REFERENCES users(id),
  decision    VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment     TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
