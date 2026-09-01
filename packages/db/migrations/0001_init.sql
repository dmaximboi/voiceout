CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  CREATE TYPE oauth_provider AS ENUM ('google', 'apple');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE media_kind AS ENUM ('avatar', 'post_audio', 'comment_audio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE media_status AS ENUM ('pending', 'ready', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE post_status AS ENUM ('pending', 'published', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reaction_type AS ENUM ('like', 'love', 'haha', 'wow', 'sad', 'angry');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM ('follow', 'comment', 'reaction', 'comment_like');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_target AS ENUM ('post', 'comment', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_reason AS ENUM ('spam', 'abuse', 'illegal', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(254) NOT NULL,
  email_verified_at timestamptz,
  password_hash text,
  handle varchar(20) NOT NULL,
  display_name varchar(50) NOT NULL,
  bio varchar(160),
  avatar_media_id uuid,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_idx ON users (handle);
CREATE INDEX IF NOT EXISTS users_handle_trgm_idx ON users USING gin (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_display_trgm_idx ON users USING gin (display_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider oauth_provider NOT NULL,
  provider_account_id varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS oauth_provider_account_idx ON oauth_accounts (provider, provider_account_id);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,
  user_agent text,
  ip varchar(64),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows (followee_id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS mutes (
  muter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id),
  CHECK (muter_id <> muted_id)
);

CREATE TABLE IF NOT EXISTS media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  kind media_kind NOT NULL,
  mime varchar(120) NOT NULL,
  bytes bigint NOT NULL,
  duration_ms integer,
  duration_cap integer,
  sha256 varchar(64),
  status media_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS media_object_key_idx ON media_objects (object_key);
CREATE INDEX IF NOT EXISTS media_user_idx ON media_objects (user_id);

CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption varchar(500) NOT NULL,
  media_id uuid NOT NULL REFERENCES media_objects(id),
  duration_ms integer NOT NULL,
  duration_cap integer NOT NULL,
  status post_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_author_created_idx ON posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_status_created_idx ON posts (status, created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body varchar(500) NOT NULL,
  media_id uuid REFERENCES media_objects(id),
  sticker_id varchar(32),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS comments_author_idx ON comments (author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_reactions (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type reaction_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS post_reactions_type_idx ON post_reactions (post_id, type);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type report_target NOT NULL,
  target_id uuid NOT NULL,
  reason report_reason NOT NULL,
  details varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(64) NOT NULL,
  meta jsonb,
  ip varchar(64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_logs (action, created_at DESC);

CREATE TABLE IF NOT EXISTS seen_posts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS trending_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_ids jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
