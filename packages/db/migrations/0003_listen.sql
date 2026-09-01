CREATE TABLE IF NOT EXISTS listen_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  listened_ms integer NOT NULL,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listen_events_user_idx ON listen_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS listen_events_post_idx ON listen_events (post_id);
