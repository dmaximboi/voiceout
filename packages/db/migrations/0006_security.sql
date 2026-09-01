ALTER TYPE oauth_provider ADD VALUE IF NOT EXISTS 'github';
ALTER TYPE oauth_provider ADD VALUE IF NOT EXISTS 'tiktok';

CREATE UNIQUE INDEX IF NOT EXISTS sessions_refresh_hash_idx ON sessions (refresh_token_hash);

CREATE OR REPLACE FUNCTION vo_forbid_id_created_at() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'id is immutable';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_immutable ON users;
CREATE TRIGGER users_immutable
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION vo_forbid_id_created_at();

DROP TRIGGER IF EXISTS posts_immutable ON posts;
CREATE TRIGGER posts_immutable
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION vo_forbid_id_created_at();

CREATE OR REPLACE FUNCTION vo_guard_password() RETURNS trigger AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
     AND current_setting('app.allow_password', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'password change not allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_guard_password ON users;
CREATE TRIGGER users_guard_password
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION vo_guard_password();

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_read ON users;
CREATE POLICY users_read ON users
  FOR SELECT
  USING (true);
DROP POLICY IF EXISTS users_write_self ON users;
CREATE POLICY users_write_self ON users
  FOR UPDATE
  USING (
    current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR id::text = current_setting('app.user_id', true)
  );
DROP POLICY IF EXISTS users_insert ON users;
CREATE POLICY users_insert ON users
  FOR INSERT
  WITH CHECK (true);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_access ON sessions;
CREATE POLICY sessions_access ON sessions
  USING (
    current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR user_id::text = current_setting('app.user_id', true)
    OR id::text = current_setting('app.session_id', true)
  )
  WITH CHECK (
    current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR user_id::text = current_setting('app.user_id', true)
  );

ALTER TABLE oauth_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_access ON oauth_accounts;
CREATE POLICY oauth_access ON oauth_accounts
  USING (
    current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR user_id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR user_id::text = current_setting('app.user_id', true)
  );
