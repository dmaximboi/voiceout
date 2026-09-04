-- Avatar cooldown, opaque post share codes, managed device login links.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_changed_at timestamptz;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS share_code varchar(12);

UPDATE posts
SET share_code = substr(md5(id::text || random()::text || clock_timestamp()::text), 1, 10)
WHERE share_code IS NULL;

ALTER TABLE posts ALTER COLUMN share_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS posts_share_code_idx ON posts (share_code);

CREATE TABLE IF NOT EXISTS device_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  label varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS device_links_user_idx ON device_links (user_id, created_at DESC);
