CREATE TABLE IF NOT EXISTS bookmarks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS bookmarks_user_idx ON bookmarks (user_id, created_at);

CREATE TABLE IF NOT EXISTS reposts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS reposts_post_idx ON reposts (post_id, created_at);

CREATE TABLE IF NOT EXISTS voices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  body varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS voices_user_post_idx ON voices (user_id, post_id);
CREATE INDEX IF NOT EXISTS voices_post_idx ON voices (post_id, created_at);
