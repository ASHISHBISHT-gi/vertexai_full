-- Week 4a: admin tools, notifications, course reviews, lecture materials, thumbnails.

-- Who did what. Rows are never edited; if the actor's account is deleted we keep the log and forget who.
CREATE TABLE audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(100) NOT NULL,         -- e.g. 'user.roles_changed'
  entity     VARCHAR(50),
  entity_id  UUID,
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(40) NOT NULL,
  title      VARCHAR(150) NOT NULL,
  body       TEXT,
  link       TEXT,                          -- where clicking it should go, e.g. /learn/<course>?tab=assignments
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- Deleting a student must be possible: their enrolments go with them. (Courses stay RESTRICTed: an instructor
-- who owns courses can't be deleted until those are dealt with.)
ALTER TABLE enrollments
  DROP CONSTRAINT enrollments_user_id_fkey,
  ADD CONSTRAINT enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
-- Approval history survives the reviewer's account.
ALTER TABLE course_approvals
  DROP CONSTRAINT course_approvals_reviewed_by_fkey,
  ALTER COLUMN reviewed_by DROP NOT NULL,
  ADD CONSTRAINT course_approvals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE lecture_resources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id    UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_size     INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_resources_lecture ON lecture_resources(lecture_id);

CREATE TABLE course_reviews (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)               -- one review per student per course
);
CREATE INDEX idx_reviews_course ON course_reviews(course_id);

-- An uploaded thumbnail image (thumbnail_url keeps working for external image links).
ALTER TABLE courses ADD COLUMN thumbnail_path TEXT;
