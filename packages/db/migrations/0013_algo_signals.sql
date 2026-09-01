ALTER TABLE posts ADD COLUMN IF NOT EXISTS lang varchar(8);

CREATE INDEX IF NOT EXISTS listen_events_user_post_idx ON listen_events (user_id, post_id);

CREATE TABLE IF NOT EXISTS share_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  sharer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clicker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, sharer_id, clicker_id)
);

CREATE INDEX IF NOT EXISTS share_clicks_sharer_idx ON share_clicks (sharer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_clicks_clicker_idx ON share_clicks (clicker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_clicks_post_idx ON share_clicks (post_id);

ALTER TABLE share_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_clicks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS share_clicks_select ON share_clicks;
CREATE POLICY share_clicks_select ON share_clicks FOR SELECT USING (
  current_setting('app.rls', true) IS DISTINCT FROM 'on'
  OR sharer_id::text = current_setting('app.user_id', true)
  OR clicker_id::text = current_setting('app.user_id', true)
);
DROP POLICY IF EXISTS share_clicks_insert ON share_clicks;
CREATE POLICY share_clicks_insert ON share_clicks FOR INSERT WITH CHECK (
  current_setting('app.rls', true) IS DISTINCT FROM 'on'
  OR clicker_id::text = current_setting('app.user_id', true)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceout_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE share_clicks TO voiceout_app;
  END IF;
END $$;
