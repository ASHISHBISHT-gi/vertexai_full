-- Week 4b: discussion forum, announcements, email delivery, per-user email preference.

ALTER TABLE users ADD COLUMN email_notifications BOOLEAN NOT NULL DEFAULT TRUE;

-- One thread per topic, per course. If the author's account is deleted the thread stays (shown as "Deleted user").
CREATE TABLE discussion_threads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  title       VARCHAR(200) NOT NULL,
  is_pinned   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_threads_course ON discussion_threads(course_id, is_pinned DESC, last_activity_at DESC);

-- A post is either the opening post or a reply. parent_id makes it threaded (reply to a specific post).
CREATE TABLE discussion_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES discussion_posts(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  content     TEXT NOT NULL,
  is_flagged  BOOLEAN NOT NULL DEFAULT FALSE,   -- true while at least one open report exists
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_posts_thread ON discussion_posts(thread_id, created_at);
CREATE INDEX idx_posts_flagged ON discussion_posts(created_at) WHERE is_flagged;

-- Who reported what, and why. One report per person per post.
CREATE TABLE post_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES discussion_posts(id) ON DELETE CASCADE,
  reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason      VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- (post_id, reporter_id) unique; NULL reporters (deleted accounts) never collide.
CREATE UNIQUE INDEX idx_reports_unique ON post_reports(post_id, reporter_id);

CREATE TABLE announcements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  posted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  title      VARCHAR(150) NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_announcements_course ON announcements(course_id, created_at DESC);

-- Emails waiting to be sent. A table instead of a queue server: the row is the job, FOR UPDATE SKIP LOCKED lets
-- several workers share it safely, and it survives restarts. status: pending -> sent | failed (after max attempts).
CREATE TABLE email_outbox (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email     VARCHAR(180) NOT NULL,
  subject      VARCHAR(200) NOT NULL,
  body         TEXT NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'pending',
  attempts     INT NOT NULL DEFAULT 0,
  last_error   TEXT,
  run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON email_outbox(run_after) WHERE status = 'pending';
