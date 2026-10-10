-- Fail-closed RLS: only an explicit app.rls = 'off' bypasses policies.
-- Empty / missing setting is deny, not allow. The API opens one transaction per
-- request and sets app.rls / app.user_id inside it (apps/api/src/lib/requestDb.ts).
-- migrate.ts re-runs every file in order, so this file must come after every file that
-- defines these functions or policies for these definitions to win over the fail-open ones.

CREATE OR REPLACE FUNCTION vo_rls_off() RETURNS boolean AS $$
  SELECT coalesce(current_setting('app.rls', true), '') = 'off';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION vo_is_user(uid uuid) RETURNS boolean AS $$
  SELECT uid IS NOT NULL
    AND coalesce(current_setting('app.user_id', true), '') <> ''
    AND uid::text = current_setting('app.user_id', true);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION vo_is_session(sid uuid) RETURNS boolean AS $$
  SELECT sid IS NOT NULL
    AND coalesce(current_setting('app.session_id', true), '') <> ''
    AND sid::text = current_setting('app.session_id', true);
$$ LANGUAGE sql STABLE;

-- Role changes only from service / admin context, never from a user-scoped request.
CREATE OR REPLACE FUNCTION vo_guard_role() RETURNS trigger AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT vo_rls_off() THEN
    RAISE EXCEPTION 'role change not allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- users (0006 / 0010 / 0012 had inline "IS DISTINCT FROM 'on'" = open when unset)
DROP POLICY IF EXISTS users_read ON users;
CREATE POLICY users_read ON users FOR SELECT USING (
  deleted_at IS NULL OR vo_rls_off() OR vo_is_user(id)
);
DROP POLICY IF EXISTS users_write_self ON users;
CREATE POLICY users_write_self ON users FOR UPDATE
  USING (vo_rls_off() OR vo_is_user(id))
  WITH CHECK (vo_rls_off() OR vo_is_user(id));
DROP POLICY IF EXISTS users_insert ON users;
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (vo_rls_off() OR role = 'user');
DROP POLICY IF EXISTS users_delete ON users;
CREATE POLICY users_delete ON users FOR DELETE USING (vo_rls_off());

-- sessions: own rows, or the one session named by a verified access token
DROP POLICY IF EXISTS sessions_access ON sessions;
CREATE POLICY sessions_access ON sessions
  USING (vo_rls_off() OR vo_is_user(user_id) OR vo_is_session(id))
  WITH CHECK (vo_rls_off() OR vo_is_user(user_id));

DROP POLICY IF EXISTS oauth_access ON oauth_accounts;
CREATE POLICY oauth_access ON oauth_accounts
  USING (vo_rls_off() OR vo_is_user(user_id))
  WITH CHECK (vo_rls_off() OR vo_is_user(user_id));

DROP POLICY IF EXISTS user_keys_access ON user_keys;
CREATE POLICY user_keys_access ON user_keys
  USING (vo_rls_off() OR vo_is_user(user_id))
  WITH CHECK (vo_rls_off() OR vo_is_user(user_id));

DROP POLICY IF EXISTS audit_select ON audit_logs;
CREATE POLICY audit_select ON audit_logs FOR SELECT USING (vo_rls_off() OR vo_is_user(user_id));

DROP POLICY IF EXISTS share_clicks_select ON share_clicks;
CREATE POLICY share_clicks_select ON share_clicks FOR SELECT USING (
  vo_rls_off() OR vo_is_user(sharer_id) OR vo_is_user(clicker_id)
);
DROP POLICY IF EXISTS share_clicks_insert ON share_clicks;
CREATE POLICY share_clicks_insert ON share_clicks FOR INSERT WITH CHECK (
  vo_rls_off() OR vo_is_user(clicker_id)
);

-- blocks: the blocked person may see that the row exists (feeds/profiles hide both ways);
-- only the blocker can create or remove it.
DROP POLICY IF EXISTS blocks_access ON blocks;
DROP POLICY IF EXISTS blocks_select ON blocks;
CREATE POLICY blocks_select ON blocks FOR SELECT USING (
  vo_rls_off() OR vo_is_user(blocker_id) OR vo_is_user(blocked_id)
);
DROP POLICY IF EXISTS blocks_insert ON blocks;
CREATE POLICY blocks_insert ON blocks FOR INSERT WITH CHECK (vo_rls_off() OR vo_is_user(blocker_id));
DROP POLICY IF EXISTS blocks_update ON blocks;
CREATE POLICY blocks_update ON blocks FOR UPDATE
  USING (vo_rls_off() OR vo_is_user(blocker_id))
  WITH CHECK (vo_rls_off() OR vo_is_user(blocker_id));
DROP POLICY IF EXISTS blocks_delete ON blocks;
CREATE POLICY blocks_delete ON blocks FOR DELETE USING (vo_rls_off() OR vo_is_user(blocker_id));

-- Device-login rows were created without RLS (token hashes readable to the app role).
ALTER TABLE device_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_links_access ON device_links;
CREATE POLICY device_links_access ON device_links
  USING (vo_rls_off() OR vo_is_user(user_id))
  WITH CHECK (vo_rls_off() OR vo_is_user(user_id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceout_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE device_links TO voiceout_app;
  END IF;
END $$;
