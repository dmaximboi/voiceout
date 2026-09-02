-- Phase 2 signal foundation: typed comment classification and bounded user signals.

ALTER TABLE comments ADD COLUMN IF NOT EXISTS category varchar(32) NOT NULL DEFAULT 'neutral';
ALTER TABLE comments ADD COLUMN IF NOT EXISTS secondary_category varchar(32);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS category_confidence real;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS reply_to_comment_id uuid REFERENCES comments(id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS reply_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comment_categories jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_category_check;
ALTER TABLE comments ADD CONSTRAINT comments_category_check CHECK (
  category IN (
    'happy', 'sad', 'anger', 'fear', 'surprise', 'neutral', 'informative',
    'questioning', 'supportive', 'critical', 'humorous', 'agreement',
    'disagreement', 'personal_story', 'advice', 'spam', 'off_topic'
  )
);
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_secondary_category_check;
ALTER TABLE comments ADD CONSTRAINT comments_secondary_category_check CHECK (
  secondary_category IS NULL OR secondary_category IN (
    'happy', 'sad', 'anger', 'fear', 'surprise', 'neutral', 'informative',
    'questioning', 'supportive', 'critical', 'humorous', 'agreement',
    'disagreement', 'personal_story', 'advice', 'spam', 'off_topic'
  )
);
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_category_confidence_check;
ALTER TABLE comments ADD CONSTRAINT comments_category_confidence_check CHECK (
  category_confidence IS NULL OR category_confidence BETWEEN 0 AND 1
);

CREATE INDEX IF NOT EXISTS comments_category_idx ON comments (category, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_secondary_category_idx ON comments (secondary_category, created_at DESC)
  WHERE secondary_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS comments_reply_idx ON comments (reply_to_comment_id, created_at)
  WHERE reply_to_comment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS search_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query varchar(64) NOT NULL,
  scope varchar(8) NOT NULL,
  result_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT search_queries_scope_check CHECK (scope IN ('users', 'posts', 'all')),
  CONSTRAINT search_queries_result_count_check CHECK (result_count >= 0),
  CONSTRAINT search_queries_query_check CHECK (length(query) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS search_queries_user_created_idx
  ON search_queries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS search_queries_user_query_idx
  ON search_queries (user_id, query);

ALTER TABLE search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_queries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS search_queries_select ON search_queries;
CREATE POLICY search_queries_select ON search_queries FOR SELECT USING (
  vo_rls_off() OR vo_is_user(user_id)
);
DROP POLICY IF EXISTS search_queries_insert ON search_queries;
CREATE POLICY search_queries_insert ON search_queries FOR INSERT WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);
DROP POLICY IF EXISTS search_queries_delete ON search_queries;
CREATE POLICY search_queries_delete ON search_queries FOR DELETE USING (
  vo_rls_off() OR vo_is_user(user_id)
);

CREATE TABLE IF NOT EXISTS feed_feedback (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(24) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id, kind),
  CONSTRAINT feed_feedback_kind_check CHECK (kind IN ('not_interested', 'hide_author')),
  CONSTRAINT feed_feedback_not_self_check CHECK (user_id <> author_id)
);

CREATE INDEX IF NOT EXISTS feed_feedback_user_kind_idx
  ON feed_feedback (user_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_feedback_user_author_idx
  ON feed_feedback (user_id, author_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS feed_feedback_hide_author_unique_idx
  ON feed_feedback (user_id, author_id) WHERE kind = 'hide_author';

ALTER TABLE feed_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feed_feedback_access ON feed_feedback;
CREATE POLICY feed_feedback_access ON feed_feedback USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);

CREATE TABLE IF NOT EXISTS user_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type varchar(24) NOT NULL,
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source varchar(32),
  dwell_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_events_type_check CHECK (
    event_type IN (
      'impression', 'seen', 'open', 'play', 'pause', 'complete', 'skip',
      'share', 'comment', 'react', 'bookmark', 'follow'
    )
  ),
  CONSTRAINT user_events_source_check CHECK (source IS NULL OR length(source) BETWEEN 1 AND 32),
  CONSTRAINT user_events_dwell_check CHECK (dwell_ms IS NULL OR dwell_ms BETWEEN 0 AND 2000000),
  CONSTRAINT user_events_target_check CHECK (
    post_id IS NOT NULL OR comment_id IS NOT NULL OR target_user_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS user_events_user_created_idx
  ON user_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_post_type_idx
  ON user_events (post_id, event_type, created_at DESC) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_events_target_user_idx
  ON user_events (target_user_id, event_type, created_at DESC) WHERE target_user_id IS NOT NULL;

ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_events_access ON user_events;
CREATE POLICY user_events_access ON user_events USING (
  vo_rls_off() OR vo_is_user(user_id)
) WITH CHECK (
  vo_rls_off() OR vo_is_user(user_id)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceout_app') THEN
    GRANT SELECT, INSERT, DELETE ON TABLE search_queries TO voiceout_app;
    GRANT SELECT, INSERT, DELETE ON TABLE feed_feedback TO voiceout_app;
    GRANT SELECT, INSERT, DELETE ON TABLE user_events TO voiceout_app;
  END IF;
END $$;
