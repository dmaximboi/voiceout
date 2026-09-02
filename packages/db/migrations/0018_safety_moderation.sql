DO $$
BEGIN
  CREATE TYPE moderation_status AS ENUM ('pending', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'account_warning';
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS warning_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS warned_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason varchar(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message varchar(500);

CREATE INDEX IF NOT EXISTS users_suspended_idx ON users (suspended_at) WHERE suspended_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_warning_count_idx ON users (warning_count) WHERE warning_count > 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_warning_count_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_warning_count_check CHECK (warning_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_suspension_reason_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_suspension_reason_check
      CHECK (suspension_reason IS NULL OR length(suspension_reason) <= 500);
  END IF;
END
$$;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS status moderation_status NOT NULL DEFAULT 'pending';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS subject_user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_note varchar(1000);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE reports r SET subject_user_id = p.author_id
FROM posts p WHERE r.subject_user_id IS NULL AND r.target_type = 'post' AND r.target_id = p.id;
UPDATE reports r SET subject_user_id = c.author_id
FROM comments c WHERE r.subject_user_id IS NULL AND r.target_type = 'comment' AND r.target_id = c.id;
UPDATE reports r SET subject_user_id = u.id
FROM users u WHERE r.subject_user_id IS NULL AND r.target_type = 'user' AND r.target_id = u.id;
DELETE FROM reports WHERE subject_user_id IS NULL;
ALTER TABLE reports ALTER COLUMN subject_user_id SET NOT NULL;

DELETE FROM reports r
USING reports newer
WHERE r.status = 'pending'
  AND newer.status = 'pending'
  AND r.reporter_id = newer.reporter_id
  AND r.target_type = newer.target_type
  AND r.target_id = newer.target_id
  AND (r.created_at, r.id) < (newer.created_at, newer.id);

CREATE UNIQUE INDEX IF NOT EXISTS reports_pending_target_reporter_idx
  ON reports (reporter_id, target_type, target_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS reports_queue_idx ON reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_subject_pending_idx
  ON reports (subject_user_id, reporter_id) WHERE status = 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_not_self_check') THEN
    ALTER TABLE reports ADD CONSTRAINT reports_not_self_check
      CHECK (subject_user_id IS NULL OR reporter_id <> subject_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_resolution_check') THEN
    ALTER TABLE reports ADD CONSTRAINT reports_resolution_check CHECK (
      (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
      OR (status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_resolution_note_check') THEN
    ALTER TABLE reports ADD CONSTRAINT reports_resolution_note_check
      CHECK (resolution_note IS NULL OR length(resolution_note) <= 1000);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS bug_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description varchar(1000) NOT NULL,
  screenshot_media_id uuid REFERENCES media_objects(id) ON DELETE SET NULL,
  status moderation_status NOT NULL DEFAULT 'pending',
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bug_feedback_description_check CHECK (length(description) BETWEEN 1 AND 1000),
  CONSTRAINT bug_feedback_resolution_note_check CHECK (
    resolution_note IS NULL OR length(resolution_note) <= 1000
  ),
  CONSTRAINT bug_feedback_resolution_check CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS bug_feedback_user_idx ON bug_feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bug_feedback_queue_idx ON bug_feedback (status, created_at DESC);

ALTER TABLE bug_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bug_feedback_select ON bug_feedback;
CREATE POLICY bug_feedback_select ON bug_feedback FOR SELECT USING (
  vo_rls_off() OR vo_is_user(user_id)
);
DROP POLICY IF EXISTS bug_feedback_insert ON bug_feedback;
CREATE POLICY bug_feedback_insert ON bug_feedback FOR INSERT WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);
DROP POLICY IF EXISTS bug_feedback_admin_update ON bug_feedback;
CREATE POLICY bug_feedback_admin_update ON bug_feedback FOR UPDATE
  USING (vo_rls_off()) WITH CHECK (vo_rls_off());
