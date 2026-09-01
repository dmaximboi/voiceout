DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'moderator', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'user';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION vo_guard_role() RETURNS trigger AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND current_setting('app.rls', true) IS NOT DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'role change not allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_guard_role ON users;
CREATE TRIGGER users_guard_role
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION vo_guard_role();

DROP POLICY IF EXISTS users_insert ON users;
CREATE POLICY users_insert ON users
  FOR INSERT
  WITH CHECK (
    current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR role = 'user'
  );

DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_insert ON audit_logs
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS audit_select ON audit_logs;
CREATE POLICY audit_select ON audit_logs
  FOR SELECT
  USING (
    current_setting('app.rls', true) IS DISTINCT FROM 'on'
    OR user_id::text = current_setting('app.user_id', true)
  );
